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
//  notation ... parser cases (sums, constants, keep and drop words,
//               advantage, exploding, d%, Fate, coins, errors) and score()
//               on hand-made reads
//  exact ...... specPmf against brute-force enumeration of every outcome
//               for small cases (3d6, 2d6+1d4-1, 4d6 drop lowest, 2d20
//               keep highest and lowest, 3dF, 2dC, d%, 1d20+3), exploding
//               d6 against a deep enumeration; moments, P(X >= x), and
//               the chi-square p-value against table values
//  physics .... (Rapier, vendor/rapier3d-compat@0.21.0) one seed gives one
//               throw; every die ends in the tray; throws come to rest
//               before MAX_T; and a batch of physical throws per die type
//               passes a chi-square fairness test (p > 0.001). Cocked dice
//               are thrown again on their own, as a player would.
// ============================================================================
import { buildDie, readDie, orientFor, TYPE_ORDER, DIE_TYPES, TILT_DEG, Q, V } from './dice.js';
import { createPhysics, simulateThrow, MAX_T, TRAYS } from './physics.js';
import { chiSquare, specPmf, moments, atLeast, prob, gammaQ, keepPmf, diePmf } from './prob.js';
import { parse, planDice, score } from './notation.js';

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

// ── notation ────────────────────────────────────────────────────────────────
section('notation');
{
  const cases = [
    ['3d6+2', '3d6 + 2'], ['4d6 drop lowest', '4d6dl1'], ['2d20 keep highest', '2d20kh1'], ['advantage', '2d20kh1'],
    ['disadvantage', '2d20kl1'], ['3d6!', '3d6!'], ['d%', '1d%'], ['4dF', '4dF'], ['3 coins', '3dC'],
    ['1d20 + 1d4 - 1', '1d20 + 1d4 − 1'], ['3d6 + 2d20 + 1d8', '3d6 + 2d20 + 1d8'], ['4d6k3', '4d6kh3'], ['5d10dh2', '5d10dh2'], ['D20', '1d20'],
  ];
  for (const [inp, want] of cases) { const r = parse(inp); ok(!r.error && r.text === want, `parse "${inp}" -> ${r.error || r.text}, want ${want}`); }
  for (const bad of ['2d7', '4d6dl4', '', 'hello', '3dF!', '200d6']) ok(!!parse(bad).error, `parse "${bad}" gives an error (${parse(bad).error})`);
  const sp = parse('3d6+2');
  ok(sp.terms.length === 2 && sp.terms[0].count === 3 && sp.terms[1].value === 2, '3d6+2 terms');
  ok(planDice(parse('2d% + 1d6')).map(p => p.type).join(',') === 'd100,d10,d100,d10,d6', 'd% plans a tens and a units die');
  // score with hand-made reads
  const R = (v, label = String(v)) => ({ value: v, label, cocked: false });
  const sc = (txt, reads, chains = {}) => { const s = parse(txt), plan = planDice(s); return score(s, plan.map((p, i) => ({ ...p, read: reads[i], chain: chains[i] }))); };
  ok(sc('4d6dl1', [R(1), R(5), R(3), R(6)]).total === 14, '4d6dl1 on 1 5 3 6 = 14');
  ok(sc('2d20kh1+3', [R(4), R(17)]).total === 20, '2d20kh1+3 on 4 17 = 20');
  ok(sc('2d20kl1', [R(4), R(17)]).total === 4, '2d20kl1 on 4 17 = 4');
  ok(sc('1d10', [R(0)]).total === 10, 'a d10 0 counts 10');
  ok(sc('1d%', [R(0, '00'), R(0)]).total === 100, 'd% 00 + 0 = 100');
  ok(sc('1d%', [R(70, '70'), R(3)]).total === 73, 'd% 70 + 3 = 73');
  ok(sc('2d6!', [R(6), R(2)], { 0: [R(6), R(1)] }).total === 15, '2d6! on 6(6,1) 2 = 15');
  ok(sc('3d6-1d4', [R(1), R(2), R(3), R(4)]).total === 2, '3d6-1d4 on 1 2 3 | 4 = 2');
}

// ── exact distributions ─────────────────────────────────────────────────────
section('exact distributions');
{
  // brute force: every outcome of every die, then the notation's rule
  const faces = s => s === 'F' ? [-1, 0, 1] : s === 'C' ? [0, 1] : Array.from({ length: s }, (_, i) => i + 1);
  function brute(txt) {
    const sp = parse(txt), dice = [];
    sp.terms.forEach((t, ti) => { if (t.kind === 'dice') for (let k = 0; k < t.count; k++) dice.push({ ti, f: faces(t.sides) }); });
    const dist = new Map(); const pick = new Array(dice.length);
    const rec = (i, w) => {
      if (i === dice.length) {
        let tot = 0;
        sp.terms.forEach((t, ti) => {
          if (t.kind === 'const') { tot += t.sign * t.value; return; }
          let v = dice.map((d, j) => d.ti === ti ? pick[j] : null).filter(x => x !== null);
          if (t.keep) { v.sort((a, b) => t.keep.hi ? b - a : a - b); v = v.slice(0, t.keep.n); }
          tot += t.sign * v.reduce((a, b) => a + b, 0);
        });
        dist.set(tot, (dist.get(tot) || 0) + w); return;
      }
      for (const x of dice[i].f) { pick[i] = x; rec(i + 1, w / dice[i].f.length); }
    };
    rec(0, 1);
    return dist;
  }
  for (const txt of ['3d6', '2d6+1d4-1', '4d6 drop lowest', '2d20kh1', '2d20kl1', '3dF', '2dC', '1d%', '1d20+3', '5d4k2', '3d8dh1']) {
    const B = brute(txt), E = specPmf(parse(txt));
    let err = 0, mass = 0;
    for (const [x, p] of B) { err = Math.max(err, Math.abs(prob(E, x) - p)); mass += p; }
    E.p.forEach((q, i) => { if (!B.has(E.lo + i)) err = Math.max(err, q); });
    ok(err < 1e-12, `${txt}: exact vs brute force, max diff ${err.toExponential(1)}`);
    const m = moments(E);
    console.log(`  ${txt.padEnd(16)} support ${E.lo}..${E.lo + E.p.length - 1}  mean ${m.mean.toFixed(4)}  var ${m.var.toFixed(4)}  max diff ${err.toExponential(1)}`);
  }
  // exploding d6: enumerate chains to depth 8
  const ex = diePmf(6, true); let err = 0;
  const want = v => { let p = 0; for (let k = 0; ; k++) { const r = v - 6 * k; if (r < 1) break; if (r < 6) { p += Math.pow(1 / 6, k + 1); break; } } return p; };
  for (let v = 1; v <= 48; v++) err = Math.max(err, Math.abs(prob(ex, v) - want(v)));
  ok(err < 1e-15, `exploding d6 against chains, max diff ${err.toExponential(1)}`);
  ok(Math.abs(moments(ex).mean - 4.2) < 1e-9, `exploding d6 mean 4.2 (${moments(ex).mean.toFixed(6)})`);
  const s46 = specPmf(parse('4d6dl1'));
  ok(Math.abs(moments(s46).mean - 15869 / 1296) < 1e-12, `4d6 drop lowest mean 15869/1296 = 12.2446 (${moments(s46).mean.toFixed(4)})`);
  ok(Math.abs(atLeast(specPmf(parse('2d20kh1')), 15) - (1 - (14 / 20) ** 2)) < 1e-12, 'advantage: P(>= 15) = 1 - (14/20)^2 = 0.51');
  ok(Math.abs(atLeast(specPmf(parse('2d20kl1')), 15) - (6 / 20) ** 2) < 1e-12, 'disadvantage: P(>= 15) = (6/20)^2 = 0.09');
  ok(Math.abs(prob(specPmf(parse('3d6')), 10) - 27 / 216) < 1e-15, '3d6: P(10) = 27/216');
  // chi-square upper tail at table values (df, x2 at p = 0.05 and 0.001)
  for (const [df, x05, x001] of [[1, 3.841, 10.828], [3, 7.815, 16.266], [5, 11.070, 20.515], [9, 16.919, 27.877], [19, 30.144, 43.820]]) {
    const a = gammaQ(df / 2, x05 / 2), b = gammaQ(df / 2, x001 / 2);
    ok(Math.abs(a - 0.05) < 2e-4 && Math.abs(b - 0.001) < 2e-5, `chi-square df ${df}: p(${x05}) = ${a.toFixed(5)}, p(${x001}) = ${b.toFixed(6)}`);
  }
  ok(Math.abs(keepPmf(diePmf(6), 3, 3, true).p.reduce((a, b) => a + b, 0) - 1) < 1e-12, 'keep all of 3d6 sums to 1');
}

// ── physics: determinism, containment, rest, fairness ──────────────────────
section('physics');
const RAPIER = (await import('../../vendor/rapier3d-compat@0.21.0/rapier.mjs')).default;
await RAPIER.init({});
const PH = createPhysics(RAPIER, { tray: 'medium' });
{
  const mix = ['d4', 'd6', 'd8', 'd10', 'd100', 'd12', 'd20', 'dF', 'coin'];
  const a = simulateThrow(PH, mix, { seed: 4242, strength: 0.6 }).reads.map(r => r.label).join(' ');
  const b = simulateThrow(PH, mix, { seed: 4242, strength: 0.6 }).reads.map(r => r.label).join(' ');
  ok(a === b, `one seed, one throw (${a} | ${b})`);
  const c = simulateThrow(PH, mix, { seed: 4243, strength: 0.6 }).reads.map(r => r.label).join(' ');
  console.log(`  seed 4242: ${a}\n  seed 4243: ${c}`);
}
{
  const [w, d] = TRAYS.medium; let outside = 0, late = 0, throws = 0;
  for (let s = 0; s < (QUICK ? 10 : 40); s++) {
    const r = simulateThrow(PH, Array(12).fill(0).map((_, i) => TYPE_ORDER[i % TYPE_ORDER.length]), { seed: 900 + s, strength: 1 });
    throws++; if (!r.rest) late++;
    for (const o of PH.dice) { const p = o.body.translation(); if (Math.abs(p.x) > w / 2 || Math.abs(p.z) > d / 2 || p.y < -0.05) outside++; }
  }
  ok(outside === 0, `${outside} dice ended outside the tray (hard throws of 12 dice)`);
  ok(late <= 1, `${late}/${throws} hard throws did not rest by ${MAX_T} s`);
}
const FAIR_N = QUICK ? 300 : 2400;
for (const t of TYPE_ORDER) {
  const die = buildDie(t), labels = [...new Set(die.valued.map(f => f.label))];
  const share = labels.map(l => die.valued.filter(f => f.label === l).length / die.valued.length);
  const cnt = Object.fromEntries(labels.map(l => [l, 0]));
  let rolls = 0, cocked = 0, seed = 7000, tsum = 0, throws = 0;
  const t0 = performance.now();
  while (rolls < FAIR_N) {
    const r = simulateThrow(PH, [t, t, t, t], { seed: ++seed * 31, strength: 0.25 + ((seed * 0.618) % 1) * 0.6 });
    tsum += r.t; throws++;
    for (let rd of r.reads) {
      let k = 0;
      while (rd.cocked && k++ < 6) { cocked++; rd = simulateThrow(PH, [t], { seed: ++seed * 31 + 7, strength: 0.35 }).reads[0]; }
      if (!rd.cocked) { cnt[rd.label]++; rolls++; }
    }
  }
  const X = chiSquare(labels.map(l => cnt[l]), share);
  ok(X.p > 0.001, `${t}: chi-square p = ${X.p.toFixed(4)} over ${rolls} physical rolls`);
  console.log(`  ${t.padEnd(5)} n ${rolls}  X2 ${X.x2.toFixed(2)} df ${X.df}  p ${X.p.toFixed(3)}  cocked ${(100 * cocked / (rolls + cocked)).toFixed(1)}%  mean rest ${(tsum / throws).toFixed(2)} s  ${((performance.now() - t0) / 1000).toFixed(1)} s wall`);
  console.log('        ' + labels.map(l => `${l || '·'}:${cnt[l]}`).join(' '));
}
PH.free();

// ── summary ─────────────────────────────────────────────────────────────────
console.log(`\n${n - fail}/${n} checks passed`);
if (fail) process.exit(1);
