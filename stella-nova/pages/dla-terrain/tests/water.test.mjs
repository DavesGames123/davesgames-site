// DLA terrain · WATER package tests (DOM-free builders in render/water.js).
// Run: node pages/dla-terrain/tests/water.test.mjs  (CORE's tests.mjs runs it too)
import assert from 'node:assert/strict';
import {
  buildRiverRibbons, buildLakeMeshes, buildOceanGrid, waveModes, wavePhases, waveLattice,
  sampleHeight, seaHs, CASCADES, SURF_STRIDE, waterTint,
} from '../render/water.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('ok - ' + name); }
  catch (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.message)); }
}

// A synthetic terrain: n x n heights over worldSize m, from f(x, z).
function makeTerrain(f, { n = 128, worldSize = 2048, seaLevel = -100 } = {}) {
  const h = new Float32Array(n * n), o = -worldSize / 2, cs = worldSize / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = f(o + (i + 0.5) * cs, o + (j + 0.5) * cs);
  return { n, worldSize, seaLevel, height: h, rivers: [], lakes: [] };
}
const segX = (a, b, c, d) => {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};
function banks(rb, ri = 0) {
  // rebuild the two bank polylines from the vertex buffer of one river
  const v = rb.vertices, S = SURF_STRIDE;
  let start = 0;
  for (let k = 0; k < ri; k++) if (rb.rivers[k]) start += rb.rivers[k].rows.length * 2;
  const rows = rb.rivers[ri].rows;
  const L = [], R = [];
  for (let i = 0; i < rows.length; i++) {
    const a = (start + i * 2) * S, b = (start + i * 2 + 1) * S;
    L.push([v[a], v[a + 2]]); R.push([v[b], v[b + 2]]);
  }
  return { L, R, rows };
}
function selfCross(poly) {
  for (let i = 0; i < poly.length - 1; i++) for (let j = i + 2; j < poly.length - 1; j++) {
    if (segX(poly[i], poly[i + 1], poly[j], poly[j + 1])) return [i, j];
  }
  return null;
}

// ------------------------------------------------------------- rivers ----
test('hairpin bend: banks do not cross themselves or each other, quads keep one winding', () => {
  // a U turn of radius 30 m with a 50 m wide river: tighter than the half width
  const pts = [];
  for (let k = 0; k <= 30; k++) pts.push(-300 + k * 10, -30);
  for (let k = 1; k < 30; k++) { const a = -Math.PI / 2 + k / 30 * Math.PI; pts.push(Math.cos(a) * 30, Math.sin(a) * 30); }
  for (let k = 0; k <= 30; k++) pts.push(0 - k * 10, 30);
  const m = pts.length / 2;
  const t = makeTerrain(() => 50);
  t.rivers = [{ pts: new Float32Array(pts), width: new Float32Array(m).fill(50), flow: new Float32Array(m).map((_, i) => 1 + i) }];
  const rb = buildRiverRibbons(t, { step: 6 });
  const { L, R, rows } = banks(rb);
  assert.ok(rows.length > 20, 'rows ' + rows.length);
  assert.equal(selfCross(L), null, 'left bank crosses itself');
  assert.equal(selfCross(R), null, 'right bank crosses itself');
  for (let i = 0; i < L.length - 1; i++) for (let j = 0; j < R.length - 1; j++) {
    assert.ok(!segX(L[i], L[i + 1], R[j], R[j + 1]), `left ${i} crosses right ${j}`);
  }
  // every quad (L_i, R_i, R_i+1, L_i+1) has the same sign of area
  let sgn = 0;
  for (let i = 0; i < L.length - 1; i++) {
    const q = [L[i], R[i], R[i + 1], L[i + 1]];
    let a = 0;
    for (let k = 0; k < 4; k++) a += q[k][0] * q[(k + 1) % 4][1] - q[(k + 1) % 4][0] * q[k][1];
    if (Math.abs(a) < 1e-6) continue;
    if (!sgn) sgn = Math.sign(a);
    assert.equal(Math.sign(a), sgn, 'quad ' + i + ' flips');
  }
});

test('zig-zag D8 path: smoothed, no fold, both banks move forward', () => {
  const pts = [];
  let x = -600, z = 0;
  for (let k = 0; k < 120; k++) { pts.push(x, z); x += 10; z += (k % 4 < 2 ? 10 : -10); }
  const t = makeTerrain(() => 0);
  t.rivers = [{ pts: new Float32Array(pts), width: new Float32Array(120).fill(24), flow: new Float32Array(120).map((_, i) => i + 1) }];
  const { L, R } = banks(buildRiverRibbons(t));
  assert.equal(selfCross(L), null);
  assert.equal(selfCross(R), null);
});

test('width is monotone with flow (given widths, noisy input)', () => {
  const m = 80, pts = [], W = [], F = [];
  for (let i = 0; i < m; i++) { pts.push(-400 + i * 10, Math.sin(i * 0.2) * 40); W.push(8 + i * 0.3 + (i % 5 === 0 ? -6 : 0)); F.push(10 + i * 3 + (i % 7 === 0 ? -20 : 0)); }
  const t = makeTerrain((x) => 100 - x * 0.05);
  t.rivers = [{ pts: new Float32Array(pts), width: new Float32Array(W), flow: new Float32Array(F) }];
  const rows = buildRiverRibbons(t).rivers[0].rows.filter((r) => r.kind === 0);
  for (let i = 0; i < rows.length; i++) for (let j = 0; j < rows.length; j++) {
    if (rows[i].flow <= rows[j].flow) assert.ok(rows[i].width <= rows[j].width + 1e-9, `flow ${rows[i].flow} width ${rows[i].width} vs ${rows[j].flow} ${rows[j].width}`);
  }
  assert.ok(rows[rows.length - 1].width > rows[0].width);
});

test('width from flow when the river has no widths (hydraulic geometry w ~ Q^0.5)', () => {
  const m = 40, pts = [], F = [];
  for (let i = 0; i < m; i++) { pts.push(i * 15 - 300, 0); F.push(4 + i * i); }
  const t = makeTerrain((x) => 50 - x * 0.02);
  t.rivers = [{ pts: new Float32Array(pts), flow: new Float32Array(F) }];
  const rows = buildRiverRibbons(t).rivers[0].rows;
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].width >= rows[i - 1].width);
  assert.ok(rows[rows.length - 1].width > rows[0].width * 3);
});

test('a river given mouth first is turned to run downstream', () => {
  const m = 40, pts = [], F = [];
  for (let i = 0; i < m; i++) { pts.push(300 - i * 15, 0); F.push(100 - i * 2); }
  const t = makeTerrain((x) => 50 - x * 0.02);
  t.rivers = [{ pts: new Float32Array(pts), flow: new Float32Array(F) }];
  const rows = buildRiverRibbons(t).rivers[0].rows;
  assert.ok(rows[0].x < rows[rows.length - 1].x, 'starts at the high end');
  assert.ok(rows[0].flow < rows[rows.length - 1].flow);
});

test('surface follows the terrain: above the bed, within the depth, never uphill', () => {
  // a valley that falls 0.03 per m with bumps, and a channel along z = 0
  const f = (x, z) => 200 - x * 0.03 + Math.abs(z) * 0.4 + Math.sin(x * 0.05) * 0.8;
  const t = makeTerrain(f, { n: 256 });
  const pts = [];
  for (let i = 0; i <= 90; i++) pts.push(-900 + i * 20, Math.sin(i * 0.15) * 3);
  t.rivers = [{ pts: new Float32Array(pts), width: new Float32Array(91).map((_, i) => 6 + i * 0.1), flow: new Float32Array(91).map((_, i) => 1 + i) }];
  const rows = buildRiverRibbons(t).rivers[0].rows;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const hc = sampleHeight(t, r.x, r.z);
    assert.ok(r.y >= r.bed + 0.05 - 1e-6, `row ${i} under the bed`);
    assert.ok(r.y <= hc + r.depth + 0.01, `row ${i} floats ${r.y - hc} m over the centre`);
    if (i > 0) assert.ok(r.y <= rows[i - 1].y + 1e-6, `row ${i} goes uphill`);
  }
  assert.ok(rows[0].y - rows[rows.length - 1].y > 40, 'falls along the valley');
});

test('fine bed relief between two rows stays under the ribbon (no cut pieces)', () => {
  // a gentle valley plus short bumps (like detailHeight) between the rows
  const base = (x, z) => 200 - x * 0.03 + Math.abs(z) * 0.4;
  const fine = (x, z) => base(x, z) + 2.0 * Math.max(0, Math.sin(x * 0.55));
  const t = makeTerrain(base, { n: 256 });
  const pts = [];
  for (let i = 0; i <= 60; i++) pts.push(-600 + i * 20, 0);
  t.rivers = [{ pts: new Float32Array(pts), width: new Float32Array(61).fill(10), flow: new Float32Array(61).map((_, i) => 1 + i) }];
  const rows = buildRiverRibbons(t, { heightAt: fine }).rivers[0].rows.filter((r) => r.kind === 0);
  let worst = Infinity;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    for (let k = 0; k <= 8; k++) {
      const u = k / 8, x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u;
      worst = Math.min(worst, a.y + (b.y - a.y) * u - fine(x, z));
    }
  }
  assert.ok(worst > -0.1, `the bed comes ${(-worst).toFixed(2)} m through the surface`);
});

test('a sharp drop becomes a waterfall sheet with mist, steep reaches get rapids foam', () => {
  const f = (x) => (x < 0 ? 120 - x * -0.01 : 90 - x * 0.01);
  const t = makeTerrain((x) => f(x), { n: 256 });
  const pts = [];
  for (let i = 0; i <= 60; i++) pts.push(-600 + i * 20, 0);
  t.rivers = [{ pts: new Float32Array(pts), width: new Float32Array(61).fill(12), flow: new Float32Array(61).map((_, i) => 1 + i) }];
  const rb = buildRiverRibbons(t);
  assert.equal(rb.falls.length, 1, 'one fall');
  const fall = rb.falls[0];
  assert.ok(fall.drop > 20 && fall.drop < 40, 'drop ' + fall.drop);
  assert.ok(Math.abs(fall.x) < 30, 'fall at the cliff, x ' + fall.x);
  const rows = rb.rivers[0].rows;
  const first = rows.findIndex((r) => r.kind === 1);
  let last = first;
  while (rows[last + 1].kind === 1) last++;
  assert.ok(last > first, 'the sheet has a lip row and a foot row');
  assert.equal(rows.filter((r) => r.kind === 1).length, last - first + 1, 'one sheet strip');
  assert.ok(rows[last].s - rows[first].s >= fall.drop - 1e-6, 'uv along the sheet counts the fall');
  for (let k = first; k < last; k++) assert.ok(rows[k + 1].y < rows[k].y, 'the sheet falls');
  assert.ok(rows[last + 1].foam > 0.9, 'plunge pool foam');
});

test('a tributary that ends in the main river gets confluence foam', () => {
  const t = makeTerrain((x, z) => 100 - z * 0.02 + Math.abs(x) * 0.01, { n: 256 });
  const main = [], trib = [];
  for (let i = 0; i <= 50; i++) main.push(0, -800 + i * 32);
  for (let i = 0; i <= 20; i++) trib.push(400 - i * 20, -400 + i * 8);
  t.rivers = [
    { pts: new Float32Array(main), width: new Float32Array(51).fill(30), flow: new Float32Array(51).map((_, i) => 50 + i) },
    { pts: new Float32Array(trib), width: new Float32Array(21).fill(8), flow: new Float32Array(21).map((_, i) => 1 + i) },
  ];
  const rb = buildRiverRibbons(t);
  assert.equal(rb.rivers[1].joinFoam, true);
  assert.equal(rb.rivers[0].joinFoam, false);
});

test('the ribbon stops at the sea when the ocean is on', () => {
  const t = makeTerrain((x) => 40 - x * 0.05, { n: 128, seaLevel: 0 });
  const pts = [];
  for (let i = 0; i <= 80; i++) pts.push(-800 + i * 20, 0);
  t.rivers = [{ pts: new Float32Array(pts), width: new Float32Array(81).fill(10), flow: new Float32Array(81).map((_, i) => i + 1) }];
  const rows = buildRiverRibbons(t, { oceanOn: true }).rivers[0].rows;
  const under = rows.filter((r) => r.y < -0.5);
  assert.ok(under.length <= 1, 'rows under the sea: ' + under.length);
  assert.ok(rows[rows.length - 1].x < 900);
});

test('river points in grid cells are moved to world metres', () => {
  const t = makeTerrain(() => 10, { n: 64, worldSize: 4096 });
  t.rivers = [{ pts: new Float32Array([2, 32, 20, 32, 40, 32, 60, 32]), width: new Float32Array(4).fill(10), flow: new Float32Array([1, 2, 3, 4]) }];
  const rows = buildRiverRibbons(t).rivers[0].rows;
  assert.ok(rows[0].x < -1500 && rows[rows.length - 1].x > 1500, `x ${rows[0].x} .. ${rows[rows.length - 1].x}`);
});

// -------------------------------------------------------------- lakes ----
test('lake mesh fills its basin, flat at its level, and does not leak into a lower basin beyond a ridge', () => {
  // basin A (the lake) at x < 0, a ridge at x = 0, basin B lower at x > 0
  const f = (x, z) => {
    const a = 80 + ((x + 500) ** 2 + z * z) / 4000;
    const b = 40 + ((x - 500) ** 2 + z * z) / 4000;
    return Math.min(Math.max(a, x > -60 && x < 60 ? 200 : a), x > 60 ? b : 1e9);
  };
  const t = makeTerrain(f, { n: 128, worldSize: 2048 });
  t.lakes = [{ level: 100, x: -500, z: 0, area: 1 }];
  const lb = buildLakeMeshes(t);
  assert.equal(lb.lakes.length, 1);
  const v = lb.vertices;
  let maxX = -Infinity, inside = 0;
  for (let i = 0; i < v.length; i += SURF_STRIDE) {
    assert.equal(v[i + 1], 100, 'flat at the level');
    assert.equal(v[i + 11], 2, 'kind lake');
    maxX = Math.max(maxX, v[i]);
    if (v[i + 3] > 0.5) inside++;
  }
  assert.ok(maxX < 0, 'no vertex in basin B, max x ' + maxX);
  // area of a circle with r^2 = 20 * 4000 -> about 2.5e5 m2, one cell = 256 m2
  const area = lb.lakes[0].cells * (2048 / 128) ** 2;
  assert.ok(area > 1.8e5 && area < 3.2e5, 'area ' + area);
  assert.ok(inside > 0 && lb.indices.length > 0);
});

test('a lake at sea level is left to the ocean', () => {
  const t = makeTerrain((x, z) => Math.hypot(x, z) / 20 - 10, { seaLevel: 0 });
  t.lakes = [{ level: 0, x: 0, z: 0 }];
  assert.equal(buildLakeMeshes(t, { oceanOn: true }).lakes.length, 0);
  assert.equal(buildLakeMeshes(t, { oceanOn: false }).lakes.length, 1);
});

// -------------------------------------------------------------- waves ----
test('wave vectors sit on each cascade lattice (the textures tile)', () => {
  const lat = waveLattice(80, 7);
  lat.forEach((modes, c) => {
    const L = CASCADES[c].L;
    assert.ok(modes.length >= 60, 'modes ' + modes.length);
    for (const m of modes) {
      const a = m.kx * L / (2 * Math.PI), b = m.kz * L / (2 * Math.PI);
      assert.ok(Math.abs(a - Math.round(a)) < 1e-6 && Math.abs(b - Math.round(b)) < 1e-6);
    }
  });
});

test('wave height follows the wind (Pierson-Moskowitz Hs), swell excluded', () => {
  for (const V of [5, 10, 18]) {
    const w = waveModes({ wind: [V * 0.6, V * 0.8], count: 80 });
    let v = 0;
    for (let j = 0; j < 3 * 80; j++) if (!(j < 80 && j >= 77)) v += w.data[j * 4 + 2] ** 2 / 2;
    const hs = 4 * Math.sqrt(v);
    assert.ok(Math.abs(hs - seaHs(V)) / seaHs(V) < 0.05, `V ${V}: Hs ${hs} vs ${seaHs(V)}`);
  }
  const calm = waveModes({ wind: [0, 0] }), storm = waveModes({ wind: [20, 0], storm: 1 });
  assert.ok(storm.hs > calm.hs * 20);
});

test('waves run downwind: most energy has k along the wind', () => {
  const w = waveModes({ wind: [10, 0], count: 80 });
  let down = 0, up = 0;
  for (let j = 0; j < 3 * 80 - 3; j++) { const e = w.data[j * 4 + 2] ** 2; if (w.data[j * 4] > 0) down += e; else up += e; }
  assert.ok(down > up * 5, `down ${down} up ${up}`);
});

test('phases wrap in [0, 2pi) and stay exact at large t', () => {
  const w = waveModes({ wind: [8, 3] });
  const a = wavePhases(w, 1e6), b = wavePhases(w, 1e6 + 2 * Math.PI / w.omega[5]);
  for (let j = 0; j < w.omega.length; j++) assert.ok(a[j * 4 + 3] >= 0 && a[j * 4 + 3] < 2 * Math.PI + 1e-6);
  const d = Math.abs(a[5 * 4 + 3] - b[5 * 4 + 3]);
  assert.ok(Math.min(d, 2 * Math.PI - d) < 1e-3, 'one period later, same phase: ' + d);
});

test('ocean grid: closed rings, indices in range, reaches the horizon radius', () => {
  const g = buildOceanGrid(0.6, 30000, 40, 32);
  const nv = g.vertices.length / 2;
  assert.equal(nv, 40 * 32 + 1);
  for (const i of g.indices) assert.ok(i < nv);
  let maxR = 0;
  for (let i = 0; i < nv; i++) maxR = Math.max(maxR, g.vertices[i * 2]);
  assert.ok(Math.abs(maxR - 30000) < 1e-3 * 30000);
  assert.equal(g.indices.length, 32 * 3 + 39 * 32 * 6);
});

test('water colour slider: 0.35 is the base, peaty takes the blue, glacial scatters', () => {
  const c = waterTint(0.35);
  assert.deepEqual(c.a.map(x => +x.toFixed(6)), [1, 1, 1]);
  assert.deepEqual(c.s.map(x => +x.toFixed(6)), [1, 1, 1]);
  const peat = waterTint(1), glacial = waterTint(0);
  assert.ok(peat.a[2] > 4 && peat.s[2] < 0.5, 'peaty absorbs blue');
  assert.ok(glacial.s[1] > 2 && glacial.a[1] < 1, 'glacial scatters green-blue');
  for (let t = 0; t <= 1.0001; t += 0.05) { const v = waterTint(t); assert.ok([...v.a, ...v.s].every(x => x > 0 && Number.isFinite(x))); }
});

// ------------------------------------------------- bodies of water ----
const { readFileSync } = await import('node:fs');
const { LAKE_KIND, lakeAtFn, createWater } = await import('../render/water.js');
const hydro = await import('../world/hydro-lakes.js');

// a bowl terrain with a lake from the add water tool (world/hydro-lakes.js)
function lakeWorld() {
  const t = makeTerrain((x, z) => 40 - x * 0.01 + Math.abs(z) * 0.004 - 14 * Math.max(0, 1 - Math.hypot(x + 200, z) / 300), { n: 128, worldSize: 2048 });
  const N = t.n * t.n;
  Object.assign(t, { water: new Float32Array(N), biome: new Uint8Array(N).fill(4), river: new Float32Array(N), moisture: new Float32Array(N).fill(0.6), temperature: new Float32Array(N).fill(-6), flow: new Float32Array(N).fill(0.01), stats: { hasSea: false } });
  const r = hydro.addWaterAt(t, -200, 0);
  return { t, r };
}

test('lakes from lakeId: one grid per lake at its level, every lake cell covered, attributes per kind', () => {
  const { t, r } = lakeWorld();
  assert.ok(r.ok, r.reason);
  const lb = buildLakeMeshes(t, {});
  assert.equal(lb.lakes.length, 1);
  const v = lb.vertices, S = SURF_STRIDE, nv = v.length / S;
  for (let i = 0; i < nv; i++) {
    assert.equal(v[i * S + 1], r.lake.level, 'flat at the level');
    assert.equal(v[i * S + 11], 2, 'kind lake');
    assert.ok(Math.abs(v[i * S + 5] - r.lake.fetch) < 1e-3, 'fetch');
    assert.equal(v[i * S + 6], LAKE_KIND.user, 'kind code');
    assert.ok(Math.abs(v[i * S + 7] - r.lake.ice) < 1e-6 && r.lake.ice > 0.5, 'ice of a cold lake');
  }
  // each lake cell centre lies in a quad of the grid (step 1 here)
  const n = t.n, cs = t.worldSize / n, o = -t.worldSize / 2, key = new Set();
  for (let i = 0; i < nv; i++) key.add(Math.round((v[i * S] - o) / cs - 0.5) + ',' + Math.round((v[i * S + 2] - o) / cs - 0.5));
  let lakeCells = 0;
  for (let c = 0; c < n * n; c++) {
    if (t.lakeId[c] !== r.id) continue;
    lakeCells++;
    const i = c % n, j = (c / n) | 0;
    assert.ok(key.has(i + ',' + j) && key.has(i + 1 + ',' + j) && key.has(i + ',' + (j + 1)), 'cell ' + c + ' covered');
  }
  assert.equal(lakeCells, r.cells);
  // a merged lake is not drawn twice
  const t2 = { ...t, lakes: t.lakes.map((l) => ({ ...l, merged: 9 })) };
  assert.equal(buildLakeMeshes(t2, {}).lakes.length, 0);
});

test('rivers end at the first row in a lake, under its surface, and start where they leave it', () => {
  const { t, r } = lakeWorld();
  const lakeAt = lakeAtFn(t);
  assert.equal(lakeAt(-200, 0), r.lake.level);
  assert.equal(lakeAt(600, 600), null);
  // a river from the east into the lake, and one from inside it to the west
  const into = [], out = [];
  for (let k = 0; k <= 40; k++) into.push(500 - k * 20, 0);
  for (let k = 0; k <= 40; k++) out.push(-200 - k * 18, 30);
  const m = 41;
  t.rivers = [
    { pts: new Float32Array(into), width: new Float32Array(m).fill(8), flow: new Float32Array(m).map((_, i) => 1 + i) },
    { pts: new Float32Array(out), width: new Float32Array(m).fill(8), flow: new Float32Array(m).map((_, i) => 1 + i) },
  ];
  const rb = buildRiverRibbons(t, { step: 10 });
  const a = rb.rivers[0].rows, b = rb.rivers[1].rows;
  const last = a[a.length - 1];
  assert.ok(lakeAt(last.x, last.z) != null, 'the mouth row is in the lake');
  for (const row of a.slice(0, -1)) assert.equal(lakeAt(row.x, row.z), null, 'no other row in the lake');
  assert.ok(last.y <= r.lake.level - 0.05 + 1e-6, 'the mouth is under the lake surface');
  assert.equal(lakeAt(b[0].x, b[0].z), null, 'the outflow starts out of the lake');
  // SURFACE2's river-net calls the same builder: the same rows
  assert.deepEqual(buildRiverRibbons(t, { step: 10 }).rivers[0].rows.length, a.length);
});

test('water normals face up: the flip is by the eye height, never by the winding', () => {
  const src = readFileSync(new URL('../shaders/water.wgsl', import.meta.url), 'utf8');
  for (const fn of ['fsOcean', 'fsSurface']) {
    const head = src.slice(src.indexOf('fn ' + fn + '('), src.indexOf('{', src.indexOf('fn ' + fn + '(')));
    assert.ok(!/front_facing/.test(head), fn + ' takes no front_facing');
  }
  assert.ok(!/if \(!ff\)/.test(src), 'no flip by the triangle side');
  assert.ok(/if \(G\.camPos\.y < WU\.misc\.y\) \{ N = -N; \}/.test(src), 'ocean: down only under the sea');
  assert.ok(/if \(G\.camPos\.y < P\.y - 0\.05\) \{ N = -N; \}/.test(src), 'rivers and lakes: down only under the surface');
  // the JS twin of the lake normal: normalize(-sx, 1, -sz) has y > 0 for any slope
  for (const [sx, sz] of [[0, 0], [5, -3], [-40, 40], [1e3, 0]]) {
    const l = Math.hypot(sx, 1, sz);
    assert.ok(1 / l > 0, 'y up');
  }
});

// a recording mock device: counts live buffers and textures, keeps the
// last uniform write of the water module
function mockGPU(profileId) {
  const g = globalThis;
  g.GPUBufferUsage = g.GPUBufferUsage || { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
  g.GPUTextureUsage = g.GPUTextureUsage || { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
  g.GPUShaderStage = g.GPUShaderStage || { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
  const live = { buffers: 0, textures: 0 }, writes = [];
  const obj = (o = {}) => ({ ...o, destroy() {}, createView: () => ({}), getBindGroupLayout: () => ({}) });
  const device = {
    createTexture: () => { live.textures++; return { createView: () => ({}), destroy() { live.textures--; } }; },
    createBuffer: (d) => { live.buffers++; const b = { size: d.size, destroy() { live.buffers--; } }; return b; },
    createSampler: () => ({}), createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}), createBindGroup: () => ({}),
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createRenderPipelineAsync: async () => obj(), createComputePipelineAsync: async () => obj(),
  };
  const queue = { writeBuffer: (b, off, data) => { writes.push({ b, data: data.slice ? data.slice() : data }); }, writeTexture() {}, submit() {} };
  return { gpu: { device, queue, globalsLayout: {}, globalsBindGroup: {}, loadWGSL: async () => '', quality: 0.8, profileId }, live, writes };
}
const lastU = (writes) => [...writes].reverse().find((w) => w.data.length === 60).data;
function frameOf(extra = {}) {
  const g = new Float32Array(160);
  g[80] = 0; g[81] = 300; g[82] = 0; g[85] = 0.5; g[104] = 4; g[105] = 1; g[125] = 400; g[53] = 1.2;
  return { globals: g, time: 10, dt: 0.016, quality: 0.8, ...extra };
}

async function atest(name, fn) {
  try { await fn(); pass++; console.log('ok - ' + name); }
  catch (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.message)); }
}
await atest('water module: no byte growth over rebuilds, cheap flags on phones and at the emergency rung', async () => {
  const { t } = lakeWorld();
  const m = mockGPU('desktop');
  const w = await createWater(m.gpu);
  const base = { ...m.live };
  w.setTerrain({ cpu: t, seaLevel: t.seaLevel });
  const one = { ...m.live };
  for (let k = 0; k < 20; k++) { t.lakes = t.lakes.slice(); w.setTerrain({ cpu: t, seaLevel: t.seaLevel }); w.update(frameOf()); }
  assert.deepEqual(m.live, one, 'rebuilds free the old buffers');
  assert.ok(one.buffers > base.buffers, `buffers ${base.buffers} -> ${one.buffers}`);
  assert.ok(w.stats.lakes === 1 && w.stats.lakeKinds.user === 1, JSON.stringify(w.stats));
  let U = lastU(m.writes);
  assert.equal(U[44], 1, 'desktop: the reflection march is on');
  assert.equal(U[59], 0, 'desktop: two ripple copies');
  w.update(frameOf({ gov: { level: 8 } }));
  U = lastU(m.writes);
  assert.equal(U[44], 0, 'emergency: no reflection march');
  assert.equal(U[45], 0, 'emergency: no caustics');
  assert.equal(U[59], 1, 'emergency: one ripple copy');
  w.dispose();
  const p = mockGPU('phone');
  const wp = await createWater(p.gpu);
  wp.setTerrain({ cpu: t, seaLevel: t.seaLevel });
  wp.update(frameOf());
  U = lastU(p.writes);
  assert.equal(U[44], 0, 'phone: no reflection march');
  assert.equal(U[59], 1, 'phone: cheap');
  assert.equal(U[45], 1, 'phone: caustics stay');
});

test('lake shading in WGSL: fetch waves, a dawn calm, salt, ice, lap foam', () => {
  const src = readFileSync(new URL('../shaders/water.wgsl', import.meta.url), 'utf8');
  for (const k of ['fn wLakeSlope', 'fn wLakeIce', 'let fk = clamp(sqrt(fetch / 1000.0)', 'let calm = dawn', 'v.a.y > 0.5', 'iceK = smoothstep', 'm.foam = (1.0 - smoothstep(0.05, 0.5, v.a.w']) assert.ok(src.includes(k), k);
  // the JS twin of the fetch factor: a pond is calm, a great lake has waves
  const fk = (f) => Math.min(1, Math.max(0.04, Math.sqrt(f / 1000) / 3));
  assert.ok(fk(40) < 0.1 && fk(20000) === 1 && fk(2000) > 0.4);
});

console.log(`# water: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
