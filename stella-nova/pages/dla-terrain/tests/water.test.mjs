// DLA terrain · WATER package tests (DOM-free builders in render/water.js).
// Run: node pages/dla-terrain/tests/water.test.mjs  (CORE's tests.mjs runs it too)
import assert from 'node:assert/strict';
import {
  buildRiverRibbons, buildLakeMeshes, buildOceanGrid, waveModes, wavePhases, waveLattice,
  sampleHeight, seaHs, CASCADES, SURF_STRIDE,
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

console.log(`# water: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
