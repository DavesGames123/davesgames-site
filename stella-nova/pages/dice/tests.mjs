// ============================================================================
//  DICE LAB  ·  tests.mjs — node stella-nova/pages/dice/tests.mjs [--quick]
// ----------------------------------------------------------------------------
//  geometry ... face count per die; each face polygon is planar and convex
//               with its normal outward; the chamfer hull keeps all points
//               inside the base shape; the d10 kites are planar
//  numbering .. the values of each die are 1..n once each (d10 0..9, d%
//               00..90, Fate two each of + - blank, coin H and T); opposite
//               faces sum to n + 1 (d6 d8 d12 d20) or 9 (d10); 1-2-3 is
//               counter-clockwise on the d6; on a d4 each face shows the
//               three other vertex numbers
//  reader ..... every face of every die, at 24 yaws, read flat and at 6
//               tilts inside TILT_DEG: the right value, not cocked; at a
//               tilt past TILT_DEG on an edge: cocked
// ============================================================================
import { buildDie, readDie, orientFor, TYPE_ORDER, DIE_TYPES, TILT_DEG, Q, V } from './dice.js';

const QUICK = process.argv.includes('--quick');
let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } };
const section = s => console.log('\n## ' + s);

// ── geometry ────────────────────────────────────────────────────────────────
section('geometry');
const FACES = { d4: 4, d6: 6, d8: 8, d10: 10, d100: 10, d12: 12, d20: 20, dF: 6, coin: 34 };
for (const t of TYPE_ORDER) {
  const d = buildDie(t);
  ok(d.faces.length === FACES[t], `${t}: ${d.faces.length} faces, want ${FACES[t]}`);
  let planar = 0, outward = true, convex = true;
  for (const f of d.faces) {
    for (const p of f.poly) planar = Math.max(planar, Math.abs(V.dot(f.n, p) - f.d));
    if (V.dot(f.n, f.c) <= 0) outward = false;
    for (let k = 0; k < f.poly.length; k++) {
      const a = f.poly[k], b = f.poly[(k + 1) % f.poly.length], c = f.poly[(k + 2) % f.poly.length];
      if (V.dot(V.cross(V.sub(b, a), V.sub(c, b)), f.n) < -1e-9) convex = false;
    }
  }
  ok(planar < 1e-9, `${t}: faces planar (max off-plane ${planar.toExponential(1)})`);
  ok(outward && convex, `${t}: faces outward and convex`);
  // every chamfer hull point lies inside every base face plane
  let out = 0;
  for (let i = 0; i < d.hull.length; i += 3) { const p = [d.hull[i], d.hull[i + 1], d.hull[i + 2]]; for (const f of d.faces) out = Math.max(out, V.dot(f.n, p) - f.d); }
  ok(out < 1e-5, `${t}: chamfer hull inside the base shape (${out.toExponential(1)})`);
  // the mesh index points at real vertices, and every triangle faces out
  const m = d.mesh; let bad = 0;
  for (let i = 0; i < m.index.length; i += 3) {
    const P = [0, 1, 2].map(k => [m.pos[m.index[i + k] * 3], m.pos[m.index[i + k] * 3 + 1], m.pos[m.index[i + k] * 3 + 2]]);
    const nn = V.cross(V.sub(P[1], P[0]), V.sub(P[2], P[0])), c = V.mul(V.add(V.add(P[0], P[1]), P[2]), 1 / 3);
    if (V.len(nn) > 1e-12 && V.dot(nn, c) < 0) bad++;
  }
  ok(bad === 0, `${t}: ${bad} mesh triangles face in`);
  console.log(`  ${t.padEnd(5)} faces ${String(d.faces.length).padStart(2)}  R ${d.R.toFixed(2)} cm  bevel ${d.bevel.toFixed(3)} cm  tris ${m.index.length / 3}`);
}

// ── numbering ───────────────────────────────────────────────────────────────
section('numbering');
const opp = (d, i) => { let b = -1, bd = 2; d.faces.forEach((f, j) => { const x = V.dot(f.n, d.faces[i].n); if (x < bd) { bd = x; b = j; } }); return b; };
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const sameSet = (a, b) => JSON.stringify(a.slice().sort((x, y) => x - y)) === JSON.stringify(b.slice().sort((x, y) => x - y));
for (const t of ['d6', 'd8', 'd12', 'd20']) {
  const d = buildDie(t), N = DIE_TYPES[t].sides, vals = d.faces.map(f => f.value);
  ok(sameSet(vals, range(1, N)), `${t}: values 1..${N} once each`);
  ok(d.faces.every((f, i) => f.value + d.faces[opp(d, i)].value === N + 1), `${t}: opposite faces sum to ${N + 1}`);
  console.log(`  ${t}: ${d.faces.map((f, i) => `${f.value}|${d.faces[opp(d, i)].value}`).slice(0, 6).join(' ')} ...`);
}
{
  const d = buildDie('d10');
  ok(sameSet(d.faces.map(f => f.value), range(0, 9)), 'd10: values 0..9');
  ok(d.faces.every((f, i) => f.value + d.faces[opp(d, i)].value === 9), 'd10: opposite faces sum to 9');
  ok(d.faces.filter(f => f.n[1] > 0).every(f => f.value % 2 === 1), 'd10: odd numbers around the top apex');
  const p = buildDie('d100');
  ok(sameSet(p.faces.map(f => f.value), range(0, 9).map(v => v * 10)), 'd%: values 00..90');
  ok(p.faces.some(f => f.label === '00'), 'd%: a 00 face');
  // kites planar: the d10 apex relation b = a (1 + cos 36) / (1 - cos 36)
  ok(d.faces.every(f => f.poly.length === 4), 'd10: ten kites');
}
{
  const d = buildDie('d6'), at = ax => d.faces.find(f => V.dot(f.n, ax) > 0.99);
  // corner (1,1,1): faces 1 (+y), 2 (+z), 3 (+x); counter-clockwise seen
  // from outside the corner means (n1 x n2) . n3 > 0
  const f1 = d.faces.find(f => f.value === 1), f2 = d.faces.find(f => f.value === 2), f3 = d.faces.find(f => f.value === 3);
  ok(V.dot(V.cross(f1.n, f2.n), f3.n) > 0.5, 'd6: 1-2-3 counter-clockwise about their corner (western)');
  ok(at([0, 1, 0]).value === 1, 'd6: 1 on +y');
}
{
  const d = buildDie('dF');
  const c = { '+': 0, '−': 0, '': 0 }; d.faces.forEach(f => { c[f.label]++; });
  ok(c['+'] === 2 && c['−'] === 2 && c[''] === 2, `Fate: two each of + − blank (${JSON.stringify(c)})`);
  ok(d.faces.every((f, i) => f.value + d.faces[opp(d, i)].value === 0), 'Fate: + opposite −, blank opposite blank');
  const k = buildDie('coin');
  ok(k.valued.length === 2 && sameSet(k.valued.map(f => f.value), [0, 1]), 'coin: two valued caps, H and T');
}
{
  const d = buildDie('d4');
  ok(d.faces.every(f => sameSet(f.corners.map(c => +c.label), [1, 2, 3, 4].filter(v => v !== f.value))), 'd4: each face shows the three other vertex numbers');
}

// ── the face reader ─────────────────────────────────────────────────────────
section('face reader');
const YAWS = QUICK ? 8 : 24;
for (const t of TYPE_ORDER) {
  const d = buildDie(t);
  let reads = 0, wrong = 0, cockFlat = 0, notCocked = 0;
  const cand = t === 'd4' ? d.faces.map((f, i) => i) : d.faces.map((f, i) => i).filter(i => d.faces[i].valued);
  for (const i of cand) {
    const want = t === 'd4' ? d.faces[i].value : d.faces[i].value;
    for (let y = 0; y < YAWS; y++) {
      const yaw = y * 2 * Math.PI / YAWS + 0.013;
      const q0 = orientFor(d, i, yaw);
      // flat, and six small tilts (< TILT_DEG) about horizontal axes
      const tilts = [0, ...[0, 1, 2, 3, 4, 5].map(k => k * Math.PI / 3)];
      tilts.forEach((ax, k) => {
        const tilt = k === 0 ? 0 : (TILT_DEG - 1.5) * Math.PI / 180;
        const q = Q.mul(Q.axisAngle([Math.cos(ax), 0, Math.sin(ax)], tilt), q0);
        const r = readDie(d, q);
        reads++;
        if (r.value !== want) wrong++;
        if (r.cocked) cockFlat++;
      });
      // past the tolerance about an axis through the face (die on an edge,
      // tipped about 2 TILT_DEG): cocked
      const q = Q.mul(Q.axisAngle([1, 0, 0.3], 2.2 * TILT_DEG * Math.PI / 180), q0);
      if (!readDie(d, q).cocked) notCocked++;
    }
  }
  ok(wrong === 0, `${t}: ${wrong} wrong of ${reads} reads`);
  ok(cockFlat === 0, `${t}: ${cockFlat} flat or slightly tilted reads flagged cocked`);
  ok(notCocked === 0, `${t}: ${notCocked} tipped reads not flagged cocked`);
  console.log(`  ${t.padEnd(5)} ${reads} reads, ${wrong} wrong; tipped and flagged ${cand.length * YAWS - notCocked}/${cand.length * YAWS}`);
}

// ── summary ─────────────────────────────────────────────────────────────────
console.log(`\n${n - fail}/${n} checks passed`);
if (fail) process.exit(1);
