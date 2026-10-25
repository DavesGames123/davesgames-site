// ============================================================================
//  ALPHA QUDITS  ·  model/tests.mjs  ·  checks of the exact engine (MODEL)
// ----------------------------------------------------------------------------
//  node stella-nova/pages/alpha-qudits/model/tests.mjs
//  Every count the paper prints is checked against our recomputation.
//  Known disagreements with the paper are asserted as disagreements, so a
//  change in either side shows up here. Exit code 1 on any failure.
//
//  grep -n targets:  section(' | function t(
// ============================================================================
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const M = await import('./index.js');
const C = await import('./complex.js');

let pass = 0, fail = 0, cur = '';
function section(s) { cur = s; }
async function t(name, fn) {
  try { await fn(); pass++; }
  catch (e) { fail++; console.log(`FAIL [${cur}] ${name}\n   ${e && e.message}`); }
}
const near = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const PAPER_INV = '137.035999189566155029183744020866799566408684673854';
const PAPER_ALPHA = '0.007297352563662260254797635588';

// ------------------------------------------------------------------ letters
section('letters');
await t('Pauli and Gell-Mann are traceless, Hermitian, tr(La Lb) = 2 delta', () => {
  for (const [d, L] of [[2, M.pauli()], [3, M.gellMann()]]) {
    assert.equal(L.length, d * d - 1);
    L.forEach((a, i) => {
      near(C.trace(a).re, 0); near(C.trace(a).im, 0);
      assert.ok(C.maxAbsDiff(a, C.dagger(a)) < 1e-12);
      L.forEach((b, j) => near(C.hsInner(a, b).re, i === j ? 2 : 0));
    });
  }
});
await t('letter kinds: 5 symmetric and 3 antisymmetric at a qutrit, 2 and 1 at a qubit', () => {
  const count = (d, n) => Array.from({ length: n }, (_, i) => M.letterInfo(d, i).symmetric).filter(Boolean).length;
  assert.equal(count(3, 8), 5); assert.equal(count(2, 3), 2);
  // anti letters are imaginary antisymmetric matrices
  M.gellMann().forEach((g, i) => {
    const anti = M.letterInfo(3, i).kind === 'anti';
    assert.ok(C.maxAbsDiff(g, anti ? C.scale(C.transpose(g), -1) : C.transpose(g)) < 1e-12);
  });
});
await t('Weyl phase is -1 at a qubit and a cube root of unity at a qutrit', () => {
  const w2 = M.weylPhase(2), w3 = M.weylPhase(3);
  assert.equal(w2.re, -1); assert.equal(w2.isSign, true);
  near(w3.re, -0.5); near(Math.abs(w3.im), Math.sqrt(3) / 2); assert.equal(w3.isSign, false);
  assert.equal(M.anticommutingReads(2), true); assert.equal(M.anticommutingReads(3), false);
});
await t('d + 1 MUBs, orthonormal within, unbiased across', () => {
  for (const d of [2, 3]) {
    const B = M.mubs(d); assert.equal(B.length, d + 1);
    const ip = (u, v) => { let r = 0, i = 0; for (let k = 0; k < d; k++) { r += u.re[k] * v.re[k] + u.im[k] * v.im[k]; i += u.re[k] * v.im[k] - u.im[k] * v.re[k]; } return r * r + i * i; };
    B.forEach((b1, x) => B.forEach((b2, y) => b1.forEach((u, i) => b2.forEach((v, j) => {
      near(ip(u, v), x === y ? (i === j ? 1 : 0) : 1 / d, 1e-12);
    }))));
  }
});
await t('traceless parts of the read projectors span d^2 - 1 and are orthogonal across bases', () => {
  for (const d of [2, 3]) {
    const r = M.mubTracelessRank(d);
    assert.equal(r.rank, d * d - 1);
    for (const p of r.parts) for (const q of r.parts) if (p.basis !== q.basis) near(p.coeffs.reduce((s, x, k) => s + x * q.coeffs[k], 0), 0, 1e-12);
  }
});
await t('three qubit commutators, each a single letter; qutrit clock and shift do not anticommute', () => {
  for (const [mu, nu] of [[0, 1], [0, 2], [1, 2]]) {
    const c = M.commutatorLetter(2, mu, nu); assert.equal(c.single, true); near(Math.abs(c.coeff.im), 2);
    assert.equal(M.lettersAnticommute(2, mu, nu), true);
  }
});
await t('transpose identity (A x 1)|w> = (1 x A^T)|w> for every letter and a random A', () => {
  for (const A of [...M.pauli()]) near(M.transposeIdentity(A, 2), 0);
  for (const A of [...M.gellMann()]) near(M.transposeIdentity(A, 3), 0);
  const R = { re: [[0.3, -1.2, 0.5], [2, 0.1, -0.7], [0.4, 0.9, 1.1]], im: [[0.2, 0.6, -0.3], [-1, 0.5, 0.8], [0.7, -0.2, 0.05]] };
  near(M.transposeIdentity(R, 3), 0);
});

// ------------------------------------------------------------------ records
section('records');
const R = M.buildRecords();
await t('slots (8, 3, 8, 3) in the order Q1, q1, Q2, q2', () => {
  assert.deepEqual(M.slots().map(s => [s.id, s.d, s.letters]), [['Q1', 3, 8], ['q1', 2, 3], ['Q2', 3, 8], ['q2', 2, 3]]);
});
await t('172 records: 169 products (73 same-end, 96 mixed, 48 at one read) and 3 commutators', () => {
  const P = R.filter(r => r.kind === 'product');
  assert.equal(R.length, 172); assert.equal(P.length, 169);
  assert.equal(P.filter(r => r.sameEnd).length, 73); assert.equal(P.filter(r => !r.sameEnd).length, 96);
  assert.equal(P.filter(r => r.edge === 'Q1q1' || r.edge === 'Q2q2').length, 48);
  assert.equal(R.filter(r => r.kind === 'commutator').length, 3);
});
await t('the exchange of reads fixes 11 products and pairs 158 into 79 even and 79 odd', () => {
  assert.equal(R.filter(r => r.combo === 'self').length, 11);
  assert.equal(R.filter(r => r.combo === 'even').length, 79);
  assert.equal(R.filter(r => r.combo === 'odd').length, 79);
  for (const r of R.filter(r => r.combo === 'even')) { const o = R[r.partner - 1]; assert.equal(o.combo, 'odd'); assert.equal(o.partner, r.id); }
});
await t('sectors 79 / 48 / 42 / 3 and weights 1, sqrt2, sqrt3, sqrt6 (Table I)', () => {
  assert.deepEqual(M.sectors(R), { '++': 79, '+-': 48, '-+': 42, '--': 3 });
  assert.deepEqual(M.sectorTable(R).map(o => [o.sector, o.k, o.count]), [['++', 1, 79], ['+-', 2, 48], ['-+', 3, 42], ['--', 6, 3]]);
});
await t('Eq. (S3): X = -p, Y = 1 same-end; X = 1, Y = -p mixed; X = Y = -1 commutators', () => {
  for (const r of R) {
    if (r.kind === 'commutator') { assert.equal(r.X, -1); assert.equal(r.Y, -1); continue; }
    if (r.sameEnd) { assert.equal(r.X, -r.parity); assert.equal(r.Y, 1); } else { assert.equal(r.X, 1); assert.equal(r.Y, -r.parity); }
  }
});
await t('Eq. (5) / Cor. S7: k = (2 - X)(3 - Y)/2 at every record', () => {
  for (const r of R) assert.equal(r.k, (2 - r.X) * (3 - r.Y) / 2);
});
await t('traces: tr X = 82, tr Y = 70, tr XY = -8, Born trace 319', () => {
  assert.deepEqual(M.exchangeTraces(R), { X: 82, Y: 70, XY: -8, born: 319, records: 172 });
  const q = (x, y, T) => (172 + x * T.X + y * T.Y + x * y * T.XY) / 4, T = M.exchangeTraces(R);
  assert.deepEqual([q(1, 1, T), q(1, -1, T), q(-1, 1, T), q(-1, -1, T)], [79, 48, 42, 3]);
});
await t('Lemma S10 polynomials at (a, b) = (8, 3) and at the smallest config (3, 3)', () => {
  const poly = (a, b) => ({ '++': (a * a - a + b * b - b) / 2 + 2 * a * b, '+-': 2 * a * b, '-+': (a * a + a + b * b + b) / 2, '--': b * (b - 1) / 2 });
  assert.deepEqual(M.sectors(R), poly(8, 3));
  assert.deepEqual(M.sectors(M.buildRecords({ smallest: true })), poly(3, 3));
});
await t('Table S3 by edge', () => {
  const E = Object.fromEntries(M.edgeTable(R).map(e => [e.edge, [e.records, e.byK]]));
  assert.deepEqual(E.Q1Q2, [64, { 1: 28, 3: 36 }]);
  assert.deepEqual(E.q1q2, [9, { 1: 3, 3: 6 }]);
  assert.deepEqual(E['Q1q1+Q2q2'], [48, { 1: 24, 2: 24 }]);
  assert.deepEqual(E['Q1q2+q1Q2'], [48, { 1: 24, 2: 24 }]);
  assert.deepEqual(E.arc, [3, { 6: 3 }]);
});
await t('records are mutually orthogonal under the trace pairing', () => {
  const key = t => t.slots.map((s, i) => s + ':' + t.letters[i]).join('|');
  const vec = r => new Map(r.terms.map(t => [key(t), t.coef]));
  const V = R.map(vec);
  for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) {
    let re = 0, im = 0;
    for (const [k, a] of V[i]) { const b = V[j].get(k); if (b) { re += a.re * b.re + a.im * b.im; im += a.re * b.im - a.im * b.re; } }
    assert.ok(Math.abs(re) < 1e-12 && Math.abs(im) < 1e-12, `records ${i + 1} and ${j + 1}`);
  }
});
await t('commutator records are the differences [s_mu, s_nu]_q1 - [s_mu, s_nu]_q2', () => {
  for (const r of R.filter(r => r.kind === 'commutator')) {
    assert.equal(r.combo, 'diff'); assert.equal(r.terms.length, 2);
    const [a, b] = r.terms; assert.equal(a.slots[0], 'q1'); assert.equal(b.slots[0], 'q2');
    near(a.coef.im, -b.coef.im); assert.equal(a.letters[0], b.letters[0]);
  }
});

// ------------------------------------------------------------------ value
section('value');
const V = M.value();
await t('Eq. (6): (79 + 48 r2 + 42 r3 + 3 r6) / 31104 and its coordinates', () => {
  assert.deepEqual(V.numerator, { a: 79, b: 48, c: 42, d: 3 }); assert.equal(V.denominator, 31104);
  assert.deepEqual(V.coords.map(c => c.text), ['79/31104', '1/648', '7/5184', '1/10368']);
  assert.equal(V.N, 24 * 36 * 36);
});
await t('exact digits of 1/alpha_cand and alpha_cand (paper Sec. S7)', () => {
  assert.equal(V.inverseDigits(48), PAPER_INV);
  assert.equal(V.digits(30), PAPER_ALPHA);
  const d60 = V.inverseDigits(60), d120 = M.inverseDigits(V.numerator, V.denominator, 120);
  assert.ok(d120.startsWith(d60), 'digits at two scales agree');
  assert.ok(d60.startsWith('137.035999189566155029183744020866'));
});
await t('integer square roots are floors', () => {
  for (const n of [0n, 1n, 2n, 3n, 4n, 99n, 100n, 101n, 10n ** 41n, 2n * 10n ** 120n]) {
    const r = M.isqrt(n); assert.ok(r * r <= n && (r + 1n) * (r + 1n) > n);
  }
});
await t('contract facts: Born 97.505, no weights 180.837', () => {
  assert.equal(M.value({ born: true }).inverse.toFixed(3), '97.505');
  assert.equal(M.value({ noWeights: true }).inverse.toFixed(3), '180.837');
});
await t('sigma offsets +0.60 CODATA, +1.57 g-2, -1.49 Rb, +5.32 Cs', () => {
  const s = Object.fromEntries(M.sigma(V.inverseDigits(30)).map(r => [r.id, r.sigma.toFixed(2)]));
  assert.deepEqual(s, { codata2022: '0.60', g2: '1.57', rb2020: '-1.49', cs2018: '5.32' });
  assert.equal(M.sigma(V.inverse, 'codata2022').toFixed(2), '0.60');
});

// ------------------------------------------------------------------ Table S5
section('table S5');
const rows = M.valueTable();
await t('every Table S5 row is recomputed and matches the printed value, except sumsAndDiffs', () => {
  const bad = rows.filter(r => !r.agrees).map(r => r.key);
  assert.deepEqual(bad, ['sumsAndDiffs']);
});
for (const r of rows) {
  await t(`row ${r.key}: inverse ${r.paper.inverse}`, () => {
    if (r.key === 'sumsAndDiffs') {
      // Our literal reading: the sums read +1 under Y (not their own sign
      // -1) and survive only X, so they land at sqrt3, not sqrt6.
      assert.deepEqual(r.value.numerator, { a: 79, b: 48, c: 45, d: 3 });
      assert.equal(r.value.inverse.toFixed(3), '133.969');
      assert.notEqual(r.value.inverse.toFixed(3), r.paper.inverse);
      return;
    }
    assert.equal(r.value.inverse.toFixed(3), r.paper.inverse);
  });
}
await t('readEnds is the one row marked fromPaper', () => {
  assert.deepEqual(rows.filter(r => r.value.fromPaper).map(r => r.key), ['readEnds']);
  const v = M.value({ readEnds: true });
  assert.deepEqual(v.ours.numerator, { a: 158, b: 96, c: 84, d: 3 }); // one record short of the paper's 82
});
await t('two rows within one percent: ends swapped and commutators at X only', () => {
  const near1 = rows.filter(r => r.key !== 'computed' && Math.abs(r.value.inverse / V.inverse - 1) < 0.01).map(r => r.key);
  assert.deepEqual(near1, ['endsSwapped', 'commutatorsXOnly']);
});

// ------------------------------------------------------------------ configs
section('configs');
const CF = M.enumerateConfigs();
const readable = CF.filter(c => c.readable);
await t('76 configurations: 23 at a qubit centre, 53 at a qutrit centre, 42 under the cap, 23 readable', () => {
  assert.equal(CF.length, 76);
  assert.equal(CF.filter(c => c.center === 2).length, 23); assert.equal(CF.filter(c => c.center === 3).length, 53);
  assert.equal(CF.filter(c => c.admitted).length, 42); assert.equal(readable.length, 23);
});
await t('Table S2: the same 23 configurations with the same readout dimensions', () => {
  const key = (c, a) => c + ':' + a;
  const ours = new Map(readable.map(c => [key(c.center, c.label), c]));
  for (const p of M.TABLE_S2) {
    const o = ours.get(key(p.center, p.arms)); assert.ok(o, 'missing ' + key(p.center, p.arms));
    assert.equal(o.N, 2 ** p.N[0] * 3 ** p.N[1]);
  }
  assert.equal(M.TABLE_S2.length, ours.size);
});
await t('Table S2 records per pair: equal except the qubit centre with two qutrit far ends', () => {
  const diff = [];
  for (const p of M.TABLE_S2) {
    const o = readable.find(c => c.center === p.center && c.label === p.arms);
    if (o.records[0].records !== p.records) diff.push(`${p.center}:${p.arms}:${o.records[0].records}/${p.records}`);
  }
  assert.deepEqual(diff, ['2:3R 3R:172/174', '2:3R 3R 2U:172/174', '2:3R 3R 3U:172/174', '2:3R 3R 3R:172/174']);
});
await t('Theorem 1: the three filters leave exactly the object', () => {
  const obj = readable.filter(c => c.filters.endRule && c.filters.twoPoint && c.filters.charge);
  assert.equal(obj.length, 1); assert.equal(obj[0].center, 3); assert.equal(obj[0].label, '2R 2R 2U'); assert.equal(obj[0].N, 31104);
});
await t('Sec. S5 failure counts: 9 fail the end rule; 9 other qutrit-centre ones fail (b); 2R 2R 2U at a qubit lacks charge', () => {
  assert.equal(readable.filter(c => !c.filters.endRule).length, 9);
  assert.equal(readable.filter(c => c.center === 3 && !c.isObject && !c.filters.twoPoint).length, 9);
  const q22 = readable.filter(c => c.center === 2 && c.filters.endRule);
  assert.equal(q22.length, 4); assert.equal(q22.filter(c => !c.filters.twoPoint).length, 3);
  const last = q22.find(c => c.filters.twoPoint); assert.equal(last.label, '2R 2R 2U'); assert.equal(last.filters.charge, false);
});
await t('the object is tied for 13th of 23 by readout dimension; the smallest is 256', () => {
  const o = readable.find(c => c.isObject); assert.equal(o.rankByN, 13);
  assert.equal(readable.filter(c => c.N === o.N).length, 2);
  assert.equal(Math.min(...readable.map(c => c.N)), 256);
});
await t('with links at the bound: 16 readable and not the object', () => {
  const B = M.enumerateConfigs({ linksAtBound: true }).filter(c => c.readable);
  assert.equal(B.length, 16); assert.equal(B.some(c => c.isObject), false);
});
await t('read cap on the 5 x 5 grid; readable types (2,2), (2,3); only (2,3) charges', () => {
  for (let a = 2; a <= 5; a++) for (let b = 2; b <= 5; b++) assert.equal(M.readCap(a, b).readable, a * b <= 6);
  assert.deepEqual(M.readableTypes(5), [[2, 2], [2, 3]]);
  assert.equal(M.readCap(3, 3).cite, 'Choi 1975'); assert.equal(M.readCap(2, 4).cite, 'Woronowicz 1976');
  assert.deepEqual(M.centralCharge(2, 2), { re: 0, im: 0 }); assert.deepEqual(M.centralCharge(2, 3), { re: 0, im: 1 });
  assert.deepEqual(M.readableTypes(5).filter(([a, b]) => M.centralCharge(a, b).im !== 0), [[2, 3]]);
});
await t('readout dimension rule: 24 * 36 * 36 at the object', () => {
  assert.equal(M.readoutDimension(), 31104);
  assert.equal(M.readoutDimension({ center: 2, far: [2, 2], unread: null }), 256);
});

// ------------------------------------------------------------------ algebra
section('algebra');
await t('Theorem S3: rank 8, null space 4, the paper basis spans it, centre along U', () => {
  const s = M.stabilizer();
  assert.equal(s.rank, 8); assert.equal(s.nullity, 4); assert.equal(s.paperInNull, true); assert.equal(s.paperSpans, true);
  assert.equal(s.centre.length, 1);
  const c = s.centre[0], U = M.unbrokenU(), f = c.diagIm[0] / U[0];
  assert.deepEqual(c.diagIm, U.map(x => x * f)); assert.equal(c.diagonal, true);
  // proportional to -8 e10 - 16 e11 + 8 e12
  const P = [0, 0, 0, 0, 0, 0, 0, 0, 0, -8, -16, 8], g = P[11] / c.coeffs[11];
  assert.deepEqual(c.coeffs.map(x => x * g), P);
});
await t('Q is central, acts as i on the link, Q = 6iY, hypercharge 1/6', () => {
  const B = M.identificationBasis(), Q = B[11];
  const mul = (a, b) => { const r = Array.from({ length: 5 }, () => Array(5).fill(0)), i = Array.from({ length: 5 }, () => Array(5).fill(0));
    for (let x = 0; x < 5; x++) for (let k = 0; k < 5; k++) for (let y = 0; y < 5; y++) { r[x][y] += a.re[x][k] * b.re[k][y] - a.im[x][k] * b.im[k][y]; i[x][y] += a.re[x][k] * b.im[k][y] + a.im[x][k] * b.re[k][y]; } return { r, i }; };
  for (const e of B) { const p = mul(Q, e), q = mul(e, Q); assert.deepEqual(p, q); }
  // on qubit a (x) qutrit b: Q acts as i (3 + (-2)) = i
  for (let a = 0; a < 2; a++) for (let b = 0; b < 3; b++) assert.equal(Q.im[a][a] + Q.im[2 + b][2 + b], 1);
  const Y = M.hypercharge(); Y.diag.forEach(([n, d], k) => assert.equal(6 * n / d, Q.im[k][k]));
  assert.deepEqual(Y.onLink, [1, 6]);
  assert.deepEqual(M.chargeQ(2, 3).im, [3, 3, -2, -2, -2]);
});
await t('matching groups of order 32 and 384; 128 of 12288 pairs fix the pair ket; orbit 96 spans 6', () => {
  assert.equal(M.matchingGroup(2).length, 32); assert.equal(M.matchingGroup(3).length, 384);
  assert.deepEqual(M.pairKetStabilizerCount(), { pairs: 12288, fix: 128, orbit: 96 });
  assert.deepEqual(M.orbitOfPairKet(), { size: 96, span: 6 });
});
await t('Lemma S3: commutant dimension 3 at d = 2, 3, 4', () => {
  for (const d of [2, 3, 4]) assert.equal(M.commutantDimension(d), 3);
});

// ------------------------------------------------------------------ states
section('states');
await t('Eq. (S1): swapping gives (1/d)|w>_14, strand amplitude d^(-3/2)', () => {
  for (const d of [2, 3, 4]) { const s = M.swapping(d); near(s.coefficient, 1 / d); assert.equal(s.isPair, true); near(s.strandAmplitude, d ** -1.5); }
});
await t('Eq. (S2): 12 terms of amplitude 1/(2 sqrt3); the join succeeds with 1/6 in a laboratory', () => {
  const J = M.jointState();
  assert.equal(J.terms.length, 12);
  for (const x of J.terms) near(x.amp, 1 / (2 * Math.sqrt(3)));
  near(J.joinProbability, 1 / 6);
  near(J.terms.reduce((s, x) => s + x.amp * x.amp, 0), 1);
  near(M.strandAmplitude([2, 3, 2]), 1 / (2 * Math.sqrt(3)));
});
await t('a qutrit-end read leaves the qubit at <e|w>; zero once, at the third basis vector', () => {
  const F = M.readFarStates();
  assert.equal(F.length, 4);
  assert.deepEqual(F.flat().filter(e => e.zero).map(e => [e.basis, e.element]), [[0, 2]]);
});

// ------------------------------------------------------------------ data
section('data');
await t('MEASUREMENTS carry values, uncertainties and citations; HISTORY has Eddington and Wyler', () => {
  assert.equal(M.MEASUREMENTS.length, 4);
  for (const m of M.MEASUREMENTS) { assert.ok(m.cite && m.value && m.unc); }
  assert.ok(M.HISTORY.some(h => h.who.includes('Eddington') && h.inverse === 136));
  assert.ok(M.HISTORY.some(h => h.who.includes('Eddington') && h.inverse === 137));
  assert.ok(M.HISTORY.some(h => h.who === 'B. Robertson') && M.HISTORY.some(h => h.who === 'R. Gilmore'));
  assert.equal(M.wylerInverse().toFixed(5), '137.03608');
});

// ------------------------------------------------------------------ look-elsewhere
section('look-elsewhere');
await t('3-smooth denominators up to 40000: the window of 1 sigma holds the candidate', () => {
  assert.equal(M.smoothDenominators(40000).length, 87);
  const r = M.lookElsewhere({ coeffMax: 100, candidate: { ...V.numerator, D: V.denominator } });
  assert.equal(r.candidateFound, true); assert.ok(r.hits >= 1);
  assert.ok(r.expected > 0 && r.expected < 1, 'expected ' + r.expected);
  assert.equal(r.params.window.lo, '137.035999156000000000');
});
await t('all denominators up to 40000: many hits, near the density estimate', () => {
  const r = M.lookElsewhere({ coeffMax: 100, denominators: { kind: 'all', max: 40000 } });
  assert.ok(r.hits > 100, 'hits ' + r.hits);
  assert.ok(r.tuples / r.expected > 0.6 && r.tuples / r.expected < 1.5, `tuples ${r.tuples} vs expected ${r.expected}`);
  for (const h of r.examples) assert.ok(Math.abs(h.sigma) <= 1.000001);
});
await t('generator progress rises to 1', () => {
  let last = 0;
  for (const s of M.lookElsewhereSteps({ coeffMax: 20 })) { assert.ok(s.progress >= last); last = s.progress; }
  assert.equal(last, 1);
});
await t('worker protocol: run, cancel, result', async () => {
  const msgs = [];
  globalThis.self = { postMessage: m => msgs.push(m) };
  await import(pathToFileURL(join(here, 'le-worker.js')).href);
  self.onmessage({ data: { cmd: 'run', id: 1, params: { coeffMax: 160 } } });
  await new Promise(r => setTimeout(r, 5));
  self.onmessage({ data: { cmd: 'cancel', id: 1 } });
  await new Promise(r => setTimeout(r, 200));
  assert.ok(msgs.some(m => m.type === 'cancelled' && m.id === 1), JSON.stringify(msgs.map(m => m.type)));
  self.onmessage({ data: { cmd: 'run', id: 2, params: { coeffMax: 100 } } });
  for (let i = 0; i < 400 && !msgs.some(m => m.id === 2 && m.type === 'result'); i++) await new Promise(r => setTimeout(r, 25));
  const res = msgs.find(m => m.id === 2 && m.type === 'result');
  assert.ok(res, 'no result'); assert.equal(res.result.candidateFound, true);
  assert.ok(msgs.some(m => m.id === 2 && m.type === 'progress'));
  delete globalThis.self;
});
await t('client falls back to page slices without Worker', async () => {
  const { startLookElsewhere } = await import('./le-client.js');
  let prog = 0;
  const job = startLookElsewhere({ coeffMax: 100 }, { onProgress: () => prog++ });
  const r = await job.promise; assert.ok(r && typeof r.hits === 'number'); assert.ok(prog > 0);
  const j2 = startLookElsewhere({ coeffMax: 160 }); j2.cancel(); assert.equal(await j2.promise, null);
});

// ------------------------------------------------------------------ hygiene
section('hygiene');
await t('the published counts appear in no engine file (only paper.js and tests)', () => {
  const files = readdirSync(here).filter(f => f.endsWith('.js') && f !== 'paper.js');
  const hits = [];
  for (const f of files) {
    readFileSync(join(here, f), 'utf8').split('\n').forEach((line, i) => {
      if (/(^|[^\w.])(79|48|42|172|31104)(?![\w.])/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});
await t('every module imports in node', async () => {
  for (const f of readdirSync(here).filter(f => f.endsWith('.js') && f !== 'le-worker.js')) await import(pathToFileURL(join(here, f)).href);
});

console.log(`${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
