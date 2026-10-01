// ============================================================================
//  PROTEIN FOLDING  ·  tests.mjs — model checks  (node tests.mjs)
// ----------------------------------------------------------------------------
//  1  force = -grad V, against central finite differences, all terms
//  2  the native structure is a local minimum (descent stays near it)
//  3  Kabsch RMSD: self ~ 0, rigid-motion invariant, no mirror fit
//  4  folding from extended at 0.8 Tm reaches Q > 0.7 (CLN025, Trp-cage)
//  5  HP energy on hand-built shapes and on a 20-mer ground state, with
//     an independent pair count
//  6  pull moves keep a valid chain and a correct running energy
//  7  exact enumeration agrees with replica exchange on a short chain
//  8  replica exchange reaches the best known 2D energy of the 20-mer
//  9  random-coil starts have no clash and never blow up
//  Exit code 1 when a check fails.
//
//  grep: function check  section
// ============================================================================
import * as M from './model.js';
import * as L from './lattice.js';
import { PROTEINS } from './proteins.js';
import { presetById } from './presets.js';

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const section = s => console.log(`\n── ${s}`);

// 1 ─ gradient
section('1 force field gradient vs finite differences');
for (const id of ['trpcage', 'villin', 'proteing']) {
  const s = M.buildSystem(PROTEINS[id], { seed: 3, T: 1 });
  M.initCoil(s); s.pull = 0.8;
  // pull the coil a little together, so native and non-native pairs are in range
  for (let k = 0; k < s.x.length; k++) s.x[k] *= 0.55;
  M.forces(s, true); const f = Float64Array.from(s.f);
  let worst = 0, h = 1e-5;
  for (let k = 0; k < s.x.length; k++) {
    const x0 = s.x[k];
    s.x[k] = x0 + h; const ep = M.forces(s, true);
    s.x[k] = x0 - h; const em = M.forces(s, true);
    s.x[k] = x0;
    worst = Math.max(worst, Math.abs(-(ep - em) / (2 * h) - f[k]) / (1 + Math.abs(f[k])));
  }
  M.forces(s, true);
  const parts = Array.from(s.Eparts, v => v.toFixed(1)).join(' ');
  check(worst < 1e-5, `${id}: worst relative force error ${worst.toExponential(2)} (parts bond angle dih nat non pull: ${parts})`);
}

// 2 ─ native minimum
section('2 native structure is a local energy minimum');
for (const id of ['trpcage', 'ubiquitin', 'myoglobin']) {
  const s = M.buildSystem(PROTEINS[id], { seed: 1 });
  M.forces(s, true);
  const E0 = s.E;
  let fmax = 0; for (let k = 0; k < s.f.length; k++) fmax = Math.max(fmax, Math.abs(s.f[k]));
  // random small kicks never lower the energy
  const rng = M.makeRng(5); let lower = 0;
  for (let t = 0; t < 200; t++) {
    const d = Float64Array.from(s.x, () => 0.05 * rng.normal());
    for (let k = 0; k < s.x.length; k++) s.x[k] = s.nat[k] + d[k];
    if (M.forces(s, true) < E0 - 1e-9) lower++;
  }
  // steepest descent from native
  s.x.set(s.nat);
  for (let it = 0; it < 3000; it++) { M.forces(s, true); for (let k = 0; k < s.x.length; k++) s.x[k] += 2e-4 * s.f[k]; }
  const E1 = M.forces(s, true), r = M.kabsch(s.x, s.nat, s.N).rmsd;
  check(lower === 0 && r < 0.3, `${id}: E(native) ${E0.toFixed(2)}, max |F| ${fmax.toFixed(3)}, 200 kicks of 0.05 A lowered E ${lower} times; descent: E ${E1.toFixed(2)}, RMSD ${r.toFixed(3)} A`);
}

// 3 ─ Kabsch
section('3 Kabsch RMSD');
{
  const p = PROTEINS.ubiquitin, n = p.seq.length, a = Float64Array.from(p.ca);
  const self = M.kabsch(a, a, n).rmsd;
  check(self < 1e-6, `ubiquitin vs itself: RMSD ${self.toExponential(2)} A`);
  const rng = M.makeRng(11);
  let worst = 0, worstFit = 0;
  for (let t = 0; t < 20; t++) {
    // random rotation from a random unit quaternion, plus a shift
    let q = [rng.normal(), rng.normal(), rng.normal(), rng.normal()]; const l = Math.hypot(...q); q = q.map(v => v / l);
    const [w, x, y, z] = q;
    const R = [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
    const b = new Float64Array(3 * n), sh = [rng() * 50, rng() * 50, rng() * 50];
    for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) b[3 * i + r] = R[3 * r] * a[3 * i] + R[3 * r + 1] * a[3 * i + 1] + R[3 * r + 2] * a[3 * i + 2] + sh[r];
    const fit = M.kabsch(b, a, n);
    worst = Math.max(worst, fit.rmsd);
    const out = M.applyFit(fit, b, new Float64Array(3 * n), n);
    for (let k = 0; k < 3 * n; k++) worstFit = Math.max(worstFit, Math.abs(out[k] - a[k]));
  }
  check(worst < 1e-6 && worstFit < 1e-6, `20 random rigid motions: worst RMSD ${worst.toExponential(2)} A, worst fitted coordinate error ${worstFit.toExponential(2)} A`);
  // a second structure: RMSD must not depend on the frame of either one
  const s = M.buildSystem(p, { seed: 2, T: 1.2 }); M.initCoil(s);
  const r1 = M.kabsch(s.x, a, n).rmsd, r2 = M.kabsch(a, s.x, n).rmsd;
  const mir = Float64Array.from(a, (v, k) => k % 3 === 0 ? -v : v);
  const rm = M.kabsch(mir, a, n).rmsd;
  check(Math.abs(r1 - r2) < 1e-9 && rm > 1, `coil vs native ${r1.toFixed(3)} A both ways (diff ${Math.abs(r1 - r2).toExponential(1)}); mirror image ${rm.toFixed(2)} A (no reflection)`);
}

// 4 ─ folding
section('4 folding from extended at 0.8 Tm (gamma 0.5, dt 0.005)');
for (const id of ['cln025', 'trpcage', 'villin']) {
  const tm = presetById(id).tm, seeds = [1, 2, 3, 4], res = [];
  const t0 = performance.now();
  for (const seed of seeds) {
    const s = M.buildSystem(PROTEINS[id], { seed, T: 0.8 * tm, gamma: 0.5 });
    M.initExtended(s);
    let first = -1, qmax = 0, tail = 0, nt = 0;
    const total = 300000;
    for (let b = 0; b < total / 1000; b++) {
      M.step(s, 1000);
      const o = M.observe(s);
      qmax = Math.max(qmax, o.Q);
      if (first < 0 && o.Q > 0.7) first = s.steps;
      if (b >= total / 1000 * 0.75) { tail += o.Q; nt++; }
    }
    res.push({ seed, first, qmax, tail: tail / nt });
  }
  const ok = res.filter(r => r.first > 0).length;
  const ms = performance.now() - t0;
  check(ok >= 3, `${id} at T = ${(0.8 * tm).toFixed(3)}: Q > 0.7 reached in ${ok}/4 runs; first passage (steps) ${res.map(r => r.first < 0 ? 'none' : r.first).join(', ')}; max Q ${res.map(r => r.qmax.toFixed(2)).join(', ')}; mean Q last quarter ${res.map(r => r.tail.toFixed(2)).join(', ')} (${(4 * 300000 / ms * 1000 / 1000).toFixed(0)}k steps/s)`);
}

// 5 ─ HP energy
section('5 HP lattice energy');
const fromDirs = (seq, dirs, dim = 2) => {
  const D = { R: [1, 0, 0], L: [-1, 0, 0], U: [0, 1, 0], D: [0, -1, 0], F: [0, 0, 1], B: [0, 0, -1] };
  const pos = new Int32Array(3 * seq.length);
  for (let i = 1; i < seq.length; i++) for (let k = 0; k < 3; k++) pos[3 * i + k] = pos[3 * i - 3 + k] + D[dirs[i - 1]][k];
  return L.setPositions(L.makeChain(seq, dim), pos);
};
const pairCount = (seq, pos) => {   // independent O(N^2) count, no hash map
  let e = 0;
  for (let i = 0; i < seq.length; i++) for (let j = i + 2; j < seq.length; j++) {
    const d = Math.abs(pos[3 * i] - pos[3 * j]) + Math.abs(pos[3 * i + 1] - pos[3 * j + 1]) + Math.abs(pos[3 * i + 2] - pos[3 * j + 2]);
    if (d === 1 && seq[i] === 'H' && seq[j] === 'H') e--;
  }
  return e;
};
{
  const sq = fromDirs('HPPH', 'RUL');
  check(L.energyOf(sq) === -1 && L.validChain(sq), `HPPH folded into a square: E = ${L.energyOf(sq)} (expect -1)`);
  const line = fromDirs('HHHH', 'RRR');
  check(L.energyOf(line) === 0, `HHHH straight: E = ${L.energyOf(line)} (expect 0; bonded pairs do not count)`);
  const cube = fromDirs('HHHHHHHH', 'RUFDLUB'.slice(0, 7), 3);
  check(L.validChain(cube) && L.energyOf(cube) === pairCount('HHHHHHHH', cube.pos), `8 H on a 2x2x2 cube: E = ${L.energyOf(cube)}, independent count ${pairCount('HHHHHHHH', cube.pos)}`);
  const b20 = L.HP_BENCH[0], g20 = fromDirs(b20.seq, 'LUURDRURURDDLDRDLLU');
  check(L.validChain(g20) && L.energyOf(g20) === -9 && pairCount(b20.seq, g20.pos) === -9, `20-mer ${b20.seq} in shape LUURDRURURDDLDRDLLU: E = ${L.energyOf(g20)}, independent count ${pairCount(b20.seq, g20.pos)}, best known ${b20.best}`);
  const b24 = L.HP_BENCH[1], g24 = fromDirs(b24.seq, 'LUUURULULDLDRDDDLDRDRUR');
  check(L.validChain(g24) && L.energyOf(g24) === -9 && pairCount(b24.seq, g24.pos) === -9, `24-mer in shape LUUURULULDLDRDDDLDRDRUR: E = ${L.energyOf(g24)}, best known ${b24.best}`);
  check(L.HP_BENCH.every(b => [20, 24, 25, 36, 48, 50, 60, 64].includes(b.seq.length) && /^[HP]+$/.test(b.seq)), `benchmark lengths ${L.HP_BENCH.map(b => b.seq.length).join(' ')}`);
}

// 6 ─ pull moves
section('6 pull moves keep the chain valid');
for (const dim of [2, 3]) {
  const rnd = M.makeRng(17), b = L.HP_BENCH[4];
  const c = L.makeChain(b.seq, dim);
  let bad = 0, acc = 0;
  for (let k = 0; k < 400; k++) {
    acc += L.mcSweep(c, 0.6, 250, rnd);
    if (!L.validChain(c) || L.energyOf(c) !== c.E || pairCount(b.seq, c.pos) !== c.E) bad++;
  }
  check(bad === 0, `${dim}D 48-mer: 100k moves, ${acc} accepted, ${bad} checks failed, final E ${c.E}`);
}

// 7 ─ enumeration
section('7 exact enumeration vs replica exchange (2D)');
{
  const seq = 'HPHPPHHPHPPHPH';   // the first 14 of the 20-mer
  const t0 = performance.now(); const ex = L.enumerate2D(seq); const ms = performance.now() - t0;
  const rnd = M.makeRng(4), s = L.createSearch(seq, { dim: 2, replicas: 6 });
  for (let k = 0; k < 3000; k++) L.searchSweep(s, rnd);
  check(ex.best === s.bestE, `${seq}: enumeration ${ex.count.toLocaleString()} walks in ${ms.toFixed(0)} ms, ground E ${ex.best}; replica exchange best ${s.bestE}`);
}

// 8 ─ benchmark search
section('8 replica exchange on the 20-mer');
{
  const b = L.HP_BENCH[0], rnd = M.makeRng(8), s = L.createSearch(b.seq, { dim: 2, replicas: 8 });
  let sweeps = 0; while (s.bestE > b.best && sweeps < 20000) { L.searchSweep(s, rnd); sweeps++; }
  check(s.bestE === b.best, `reached E = ${s.bestE} (best known ${b.best}) after ${s.moves.toLocaleString()} moves; swap acceptance ${(s.swapAcc / s.swapTry * 100).toFixed(0)}%`);
}

// 9 ─ start shapes
section('9 start shapes for every preset (3 seeds, 20k steps each)');
{
  let worstE = -Infinity, worstD = Infinity, blow = 0, n = 0;
  for (const [id, p] of Object.entries(PROTEINS)) for (const seed of [1, 2, 3]) {
    const s = M.buildSystem(p, { seed, T: 0.7 * presetById(id).tm, gamma: 0.5 });
    M.initCoil(s); n++;
    worstE = Math.max(worstE, s.E);
    for (let i = 0; i < s.N; i++) for (let j = i + 3; j < s.N; j++) worstD = Math.min(worstD, Math.hypot(s.x[3 * i] - s.x[3 * j], s.x[3 * i + 1] - s.x[3 * j + 1], s.x[3 * i + 2] - s.x[3 * j + 2]));
    M.step(s, 20000); blow += s.blowups || 0;
  }
  check(worstE < 1e4 && worstD > 3.5 && blow === 0, `${n} random coils: highest start energy ${worstE.toFixed(0)}, closest pair (j >= i+3) ${worstD.toFixed(2)} A, blow-ups ${blow}`);
}

console.log(`\n${fails ? fails + ' FAILED' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
