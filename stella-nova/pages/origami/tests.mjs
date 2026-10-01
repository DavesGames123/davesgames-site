// tests.mjs -- the Rust unit tests of origami, ported to Node. Run: node tests.mjs
//
// Each test names the Rust test it ports (module::name). The GPU-only tests
// (tris and lines shaders compile on a device) are covered by naga and by the
// headless browser check instead. The theme tests run on both native palettes.
//
// grep map:
//   test(        -- one ported test
//   PARITY       -- optional: compare against a Rust node dump (argv[2])

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Assignment, CreasePattern, MERGE_EPS, targetAngle } from './model.js';
import { planarize } from './planarize.js';
import { checkVertex, report, reportOk } from './foldability.js';
import { toJson, fromJson, fromFold } from './foldio.js';
import * as sim from './sim.js';
import { dihedralAngle, dihedralGrad } from './solver.js';
import { triangulate, cross } from './triangulate.js';
import * as patterns from './patterns.js';
import { View2D, snap } from './view.js';
import * as theme from './theme.js';

const here = dirname(fileURLToPath(import.meta.url));
await patterns.preloadFolds((n) => readFile(join(here, 'patterns', n), 'utf8'));
const THUMBS = JSON.parse(await readFile(join(here, 'thumbs.json'), 'utf8'));

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`ok    ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}
function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const { Mountain: M, Valley: V, Border: B, Unassigned: U } = Assignment;

// ── model ───────────────────────────────────────────────────────────────────
test('model::a_new_square_has_four_border_creases', () => {
  const cp = CreasePattern.newSquare(0.5);
  assert(cp.vertices.length === 4 && cp.edges.length === 4);
  assert(cp.assignment.every((a) => a === B));
});
test('model::add_vertex_reuses_a_point_within_epsilon', () => {
  const cp = new CreasePattern();
  const a = cp.addVertex([0.1, 0.1]);
  const b = cp.addVertex([0.1 + MERGE_EPS * 0.5, 0.1]);
  assert(a === b, 'a point a fraction of EPS away should reuse the vertex');
  assert(cp.addVertex([0.2, 0.2]) !== a);
});
test('model::a_crease_between_two_vertices_is_reassigned_not_duplicated', () => {
  const cp = CreasePattern.newSquare(0.5);
  const n = cp.edgeCount();
  cp.addCrease([-0.5, -0.5], [0.5, 0.5], M);
  assert(cp.edgeCount() === n + 1);
  cp.addCrease([0.5, 0.5], [-0.5, -0.5], V);
  assert(cp.edgeCount() === n + 1, 'the diagonal was duplicated');
  assert(cp.assignment[cp.assignment.length - 1] === V);
});
test('model::a_zero_length_crease_is_rejected', () => {
  const cp = new CreasePattern();
  assert(cp.addCrease([0, 0], [MERGE_EPS * 0.1, 0], M) === null);
});
test('model::the_fold_sign_convention_holds', () => {
  assert(targetAngle(V) > 0 && targetAngle(M) < 0 && targetAngle(B) === 0);
});

// ── planarize ───────────────────────────────────────────────────────────────
test('planarize::a_square_with_one_diagonal_has_two_faces', () => {
  const cp = CreasePattern.newSquare(0.5);
  cp.addCrease([-0.5, -0.5], [0.5, 0.5], M);
  const p = planarize(cp);
  assert(p.faces.length === 2 && p.faces.every((f) => f.length === 3));
});
test('planarize::crossing_diagonals_split_at_the_centre_into_four_faces', () => {
  const cp = CreasePattern.newSquare(0.5);
  cp.addCrease([-0.5, -0.5], [0.5, 0.5], M);
  cp.addCrease([0.5, -0.5], [-0.5, 0.5], V);
  const p = planarize(cp);
  assert(p.faces.length === 4, `faces ${p.faces.length}`);
  assert(p.vertices.length === 5, `vertices ${p.vertices.length}`);
});
test('planarize::a_t_junction_splits_the_crossed_crease', () => {
  const cp = CreasePattern.newSquare(0.5);
  cp.addCrease([-0.5, 0], [0.5, 0], M);
  cp.addCrease([0, 0], [0, 0.5], V);
  const p = planarize(cp);
  const horiz = p.edges.filter((e) => Math.abs(p.vertices[e[0]][1]) < 1e-4 && Math.abs(p.vertices[e[1]][1]) < 1e-4);
  assert(horiz.length >= 2);
});
test('planarize::an_empty_pattern_has_no_faces', () => {
  assert(planarize(new CreasePattern()).faces.length === 0);
});

// ── foldability ─────────────────────────────────────────────────────────────
function star(dirs) {
  const cp = new CreasePattern();
  cp.vertices.push([0, 0]);
  for (const [deg, kind] of dirs) {
    const r = deg * Math.PI / 180;
    const tip = cp.addVertex([Math.cos(r) * 0.4, Math.sin(r) * 0.4]);
    cp.edges.push([0, tip]); cp.assignment.push(kind); cp.foldAngle.push(0);
  }
  return cp;
}
test('foldability::a_symmetric_degree_four_vertex_folds_flat', () => {
  const r = checkVertex(star([[0, M], [90, M], [180, M], [270, V]]), 0);
  assert(r && r.kawasakiOk && r.maekawa === 2 && r.maekawaOk && reportOk(r));
});
test('foldability::uneven_sectors_fail_kawasaki', () => {
  const r = checkVertex(star([[0, M], [90, M], [170, M], [270, V]]), 0);
  assert(!r.kawasakiOk && r.kawasakiResidual > 10);
});
test('foldability::balanced_mountains_and_valleys_fail_maekawa', () => {
  const r = checkVertex(star([[0, M], [90, V], [180, M], [270, V]]), 0);
  assert(r.kawasakiOk && r.maekawa === 0 && !r.maekawaOk && !reportOk(r));
});
test('foldability::an_undecided_crease_leaves_maekawa_indeterminate', () => {
  const r = checkVertex(star([[0, M], [90, M], [180, M], [270, U]]), 0);
  assert(r.maekawa === null && r.kawasakiOk);
});
test('foldability::a_boundary_vertex_is_not_checked', () => {
  const cp = CreasePattern.newSquare(0.5);
  assert(checkVertex(cp, 0) === null && report(cp).length === 0);
});

// ── fold_io ─────────────────────────────────────────────────────────────────
test('fold_io::a_square_round_trips_through_fold_json', () => {
  const cp = CreasePattern.newSquare(0.5);
  cp.addCrease([-0.5, -0.5], [0.5, 0.5], M);
  cp.addCrease([0.5, -0.5], [-0.5, 0.5], V);
  const back = fromJson(toJson(cp));
  assert(back.vertices.length === cp.vertices.length && back.edges.length === cp.edges.length);
  assert(back.assignment.join() === cp.assignment.join());
  back.vertices.forEach((v, i) => assert(dist(v, cp.vertices[i]) < 1e-5));
});
test('fold_io::the_fold_keys_are_the_spec_keys', () => {
  const json = toJson(CreasePattern.newSquare(0.5));
  for (const k of ['vertices_coords', 'edges_vertices', 'edges_assignment', 'edges_foldAngle']) assert(json.includes(k), k);
});
test('fold_io::a_three_dimensional_coordinate_drops_its_z', () => {
  const cp = fromFold({ vertices_coords: [[0.1, 0.2, 0.9]] });
  assert(cp.vertices.length === 1 && Math.abs(cp.vertices[0][0] - 0.1) < 1e-6 && Math.abs(cp.vertices[0][1] - 0.2) < 1e-6);
});
test('fold_io::a_missing_assignment_array_reads_as_unassigned', () => {
  const cp = fromFold({ vertices_coords: [[0, 0], [1, 0]], edges_vertices: [[0, 1]] });
  assert(cp.assignment.length === 1 && cp.assignment[0] === U);
});

// ── sim ─────────────────────────────────────────────────────────────────────
function folded(cp, fraction, steps) {
  const mesh = sim.build(planarize(cp));
  mesh.setFraction(fraction);
  for (let i = 0; i < steps; i++) mesh.step();
  return mesh;
}
function single(kind) {
  const cp = CreasePattern.newSquare(0.5);
  cp.addCrease([0, -0.5], [0, 0.5], kind);
  return cp;
}
const maxAbsZ = (m) => { let z = 0; for (let i = 0; i < m.nodeCount; i++) z = Math.max(z, Math.abs(m.nodes[3 * i + 2])); return z; };
const foldTheta = (m) => m.theta[m.creases.findIndex((c) => c.isFold)];
test('sim::a_single_crease_folds_out_of_the_plane', () => {
  const z = maxAbsZ(folded(single(V), 1, 200));
  assert(z > 0.1, `max |z| ${z}`);
});
test('sim::a_full_fold_stays_bounded', () => {
  const m = folded(single(V), 1, 600);
  for (let i = 0; i < m.nodeCount; i++) {
    const p = m.node(i);
    assert(p.every(Number.isFinite) && Math.hypot(...p) < 6, `node ${p}`);
  }
  assert(Math.max(...m.theta) > 2, 'the crease never folded far');
});
test('sim::reset_flat_returns_a_tangled_sheet_to_the_plane', () => {
  const m = folded(single(V), 1, 300);
  m.resetFlat();
  assert(maxAbsZ(m) < 0.01 && m.vel.every((v) => v === 0));
});
test('sim::a_mountain_and_a_valley_fold_opposite_ways', () => {
  const m = foldTheta(folded(single(M), 1, 600));
  const v = foldTheta(folded(single(V), 1, 600));
  assert(m < -0.5 && v > 0.5, `m ${m} v ${v}`);
});

// ── solver ──────────────────────────────────────────────────────────────────
test('solver::a_flat_hinge_reads_zero', () => {
  assert(Math.abs(dihedralAngle([0, 0, 0], [1, 0, 0], [0.5, 1, 0], [0.5, -1, 0])) < 1e-5);
});
test('solver::folding_one_triangle_up_gives_a_signed_angle', () => {
  const up = dihedralAngle([0, 0, 0], [1, 0, 0], [0.5, 1, 0], [0.5, -1, 0.6]);
  const down = dihedralAngle([0, 0, 0], [1, 0, 0], [0.5, 1, 0], [0.5, -1, -0.6]);
  assert(Math.abs(up) > 0.1 && up * down < 0);
});
test('solver::the_gradient_matches_a_finite_difference_and_sums_to_zero', () => {
  const base = [[0.1, -0.2, 0.05], [1.2, 0.1, -0.1], [0.6, 1.1, 0.3], [0.4, -1.0, -0.2]];
  const g = dihedralGrad(...base);
  const sum = [0, 1, 2].map((k) => g.reduce((s, v) => s + v[k], 0));
  assert(Math.hypot(...sum) < 1e-4, `sum ${sum}`);
  const h = 1e-5;
  for (let node = 0; node < 4; node++) {
    for (let axis = 0; axis < 3; axis++) {
      const plus = base.map((v) => v.slice()), minus = base.map((v) => v.slice());
      plus[node][axis] += h; minus[node][axis] -= h;
      const fd = (dihedralAngle(...plus) - dihedralAngle(...minus)) / (2 * h);
      assert(Math.abs(fd - g[node][axis]) < 1e-2, `node ${node} axis ${axis}: ${g[node][axis]} vs ${fd}`);
    }
  }
});

// ── triangulate ─────────────────────────────────────────────────────────────
test('triangulate::a_triangle_is_itself', () => {
  assert(JSON.stringify(triangulate([[0, 0], [1, 0], [0, 1]])) === '[[0,1,2]]');
});
test('triangulate::a_square_makes_two_triangles', () => {
  assert(triangulate([[0, 0], [1, 0], [1, 1], [0, 1]]).length === 2);
});
test('triangulate::triangles_cover_the_polygon_area', () => {
  const poly = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
  const t = triangulate(poly);
  assert(t.length === 4);
  const area = t.reduce((s, x) => s + Math.abs(cross(poly[x[0]], poly[x[1]], poly[x[2]])) * 0.5, 0);
  assert(Math.abs(area - 3) < 1e-4, `area ${area}`);
});

// ── view ────────────────────────────────────────────────────────────────────
test('view::to_px_and_back_round_trips', () => {
  const v = View2D.fit([200, 0, 1000, 800], 40);
  const p = [0.3, -0.2];
  assert(dist(v.toWorld(v.toPx(p)), p) < 1e-4);
});
test('view::snap_pulls_to_a_grid_point', () => {
  const v = View2D.fit([0, 0, 800, 800], 20);
  assert(dist(snap([0.004, -0.003], CreasePattern.newSquare(0.5), 8, v, 12), [0, 0]) < 1e-4);
});
test('view::a_point_far_from_any_target_is_unchanged', () => {
  const v = View2D.fit([0, 0, 800, 800], 20);
  const s = snap([0.137, 0.221], new CreasePattern(), 0, v, 8);
  assert(s[0] === 0.137 && s[1] === 0.221);
});

// ── theme ───────────────────────────────────────────────────────────────────
const lum = (c) => (c[0] + c[1] + c[2]) / 3;
test('theme::panels_sit_above_the_canvas_in_both_modes', () => {
  for (const t of [theme.light(), theme.dark(), theme.site()]) assert(lum(t.panel) > lum(t.canvas));
});
test('theme::a_field_reads_as_recessed_against_its_panel', () => {
  assert(lum(theme.light().field) > lum(theme.light().panel));
  assert(lum(theme.dark().field) < lum(theme.dark().panel));
  assert(lum(theme.site().field) < lum(theme.site().panel));
});
test('theme::a_mountain_is_warmer_than_a_valley', () => {
  for (const t of [theme.light(), theme.dark(), theme.site()]) assert(t.mountain[0] > t.valley[0] && t.valley[2] > t.mountain[2]);
});

// ── patterns ────────────────────────────────────────────────────────────────
const P = patterns.Preset;
test('patterns::every_preset_loads_and_planarizes', () => {
  assert(patterns.NATIVE.length === 20, `${patterns.NATIVE.length} native presets`);
  for (const p of patterns.ALL) {
    const cp = patterns.build(p);
    if (p === P.BlankSquare) continue;
    const planar = planarize(cp);
    assert(planar.faces.length > 0, `${p.label} planarized to no faces`);
    for (const v of cp.vertices) assert(Math.abs(v[0]) <= 0.55 && Math.abs(v[1]) <= 0.55, `${p.label} vertex ${v} left the sheet`);
  }
});
test('patterns::the_simple_presets_fold_bounded', () => {
  for (const p of [P.SingleFold, P.Waterbomb, P.Pleat, P.MiuraOri, P.Vertex4]) {
    const m = folded(patterns.build(p), 1, 400);
    for (let i = 0; i < m.nodeCount; i++) {
      const q = m.node(i);
      assert(q.every(Number.isFinite) && Math.hypot(...q) < 8, `${p.label} blew up at ${q}`);
    }
  }
});
test('patterns::the_classic_models_stay_finite_part_folded', () => {
  for (const p of [P.Sailboat, P.Kabuto, P.BirdBase, P.Crane]) {
    const m = folded(patterns.build(p), 0.5, 250);
    assert(m.nodes.every(Number.isFinite), `${p.label} went non-finite`);
  }
});
test('patterns::the_library_groups_cover_every_preset_once', () => {
  const all = patterns.GROUPS.flatMap((g) => g.list);
  const n = patterns.ALL.length;
  assert(all.length === n && new Set(all).size === n, `${all.length} in groups, ${n} presets`);
  assert(new Set(patterns.ALL.map((p) => p.id)).size === n, 'two presets share an id');
});
test('patterns::the_native_ids_are_kept', () => {
  const ids = 'blank single waterbomb blintz vertex4 vertex6 vertex8 birdbase pleat miura miura-xl pinwheel ' +
    'sailboat boat kabuto house yakko pig crane birdbase9';
  assert(patterns.NATIVE.map((p) => p.id).join(' ') === ids);
});
test('patterns::every_preset_has_a_source_and_a_thumbnail', () => {
  for (const p of patterns.ALL) {
    assert(patterns.SOURCES[p.src], `${p.id} has no source`);
    assert(p.gen || !p.file || p.path, `${p.id} has a file and no upstream path`);
    const t = THUMBS[p.id];
    assert(t && (t.m || t.v || t.b), `${p.id} has no thumbnail`);
  }
});

// One test per preset: it loads, planarizes, builds a fold mesh, stays finite
// part folded (fraction 0.5, 250 steps, as the classic-model test), and stays
// under the node cap that keeps the library interactive on a phone.
const NODE_CAP = 450;
for (const p of patterns.ALL) {
  test(`preset::${p.id} loads, planarizes and stays finite at 0.5`, () => {
    const cp = patterns.build(p);
    const planar = planarize(cp);
    if (p !== P.BlankSquare) assert(planar.faces.length > 0, 'planarized to no faces');
    for (const v of cp.vertices) assert(Math.abs(v[0]) <= 0.55 && Math.abs(v[1]) <= 0.55, `vertex ${v} left the sheet`);
    const m = sim.build(planar);
    assert(m.nodeCount <= NODE_CAP, `${m.nodeCount} nodes, over the cap of ${NODE_CAP}`);
    assert(p === P.BlankSquare || m.creases.some((c) => c.isFold), 'no crease folds');
    m.setFraction(0.5);
    for (let i = 0; i < 250; i++) m.step();
    assert(m.nodes.every(Number.isFinite), 'went non-finite');
    for (let i = 0; i < m.nodeCount; i++) assert(Math.hypot(...m.node(i)) < 8, `node ${i} flew off`);
  });
}

// ── PARITY: compare against a Rust node dump, if one is passed ──────────────
const dump = process.argv[2];
if (dump) {
  const ref = JSON.parse(await readFile(dump, 'utf8'));
  for (const r of ref) {
    const p = patterns.byId(r.id);
    const cp = planarize(patterns.build(p));
    const m = sim.build(cp);
    test(`parity::${r.id} topology (nodes, tris, beams, creases)`, () => {
      const got = [m.nodeCount, m.tris.length, m.beams.length, m.creases.length].join('/');
      const want = [r.nodes.length, r.tris, r.beams, r.creases].join('/');
      assert(got === want, `js ${got} rust ${want}`);
      // dt may differ by one f32 ulp: the rest lengths here round once, not per op.
      assert(Math.abs(m.dt - r.dt) <= 1e-6 * r.dt, `dt js ${m.dt} rust ${r.dt}`);
    });
    m.setFraction(r.fraction);
    for (let s = 0; s < r.steps; s++) m.step();
    let se = 0, worst = 0, ext = 0;
    for (let i = 0; i < m.nodeCount; i++) {
      const a = m.node(i), b = r.nodes[i];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      se += d * d; worst = Math.max(worst, d); ext = Math.max(ext, Math.hypot(...b));
    }
    const rms = Math.sqrt(se / m.nodeCount);
    console.log(`      ${r.id}: fraction ${r.fraction}, ${r.steps} steps, node RMS diff ${rms.toExponential(3)}, ` +
      `max ${worst.toExponential(3)} (sheet radius ${ext.toFixed(3)})`);
    // The crane self-intersects part folded, and its state is chaotic: the f32
    // rounding of the native sim against the f64 arithmetic here grows to a few
    // percent. Every other case stays far under 1%.
    const tol = r.id === 'crane' ? 0.05 : 0.01;
    test(`parity::${r.id} nodes match the Rust sim within ${tol * 100}% of the sheet`, () => {
      assert(worst < tol * Math.max(ext, 1e-6), `max node distance ${worst}`);
    });
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
