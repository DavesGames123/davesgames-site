// ============================================================================
//  CHLADNI PLATE  ·  tests.mjs — node tests.mjs
// ----------------------------------------------------------------------------
//  Runs solver.js in Node (no worker) and compares the free-plate modes
//  with published values (A. W. Leissa, Vibration of Plates, NASA SP-160):
//    square, nu = 0.3 .... omega a^2 sqrt(rho h / D), a = side
//    disc,   nu = 0.33 ... omega a^2 sqrt(rho h / D), a = radius
//  Then it checks the nodal labels of the disc modes, and that every
//  instrument plate solves with 24 converged modes.
// ============================================================================
import fs from 'fs';
import vm from 'vm';

const here = new URL('.', import.meta.url).pathname;
const ctx = { console, Math, Date };
ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(here + 'plates.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(here + 'solver.js', 'utf8'), ctx);
const P = ctx.CPlates, S = ctx.CSolver;
P.MATERIALS.nu30 = { name: 'test', rho: 1, E: 1, nu: 0.3 };
P.MATERIALS.nu33 = { name: 'test', rho: 1, E: 1, nu: 0.33 };

let fail = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + msg); if (!ok) fail++; };
const omega = (r, a) => Array.from(r.lambda).map(l => Math.sqrt(l) * (a / r.h) ** 2);

// Leissa table 4.47 (square, free) and 2.4 (disc, free); 4 % tolerance.
const SQUARE = [13.468, 19.596, 24.270, 34.801, 34.801, 61.093, 61.093, 63.686, 69.270];
const DISC = [5.253, 5.253, 9.084, 12.23, 12.23, 20.52, 20.52, 21.6, 21.6];
const sq = S.solve({ shape: 'square', bracing: 'none', bc: 'free', material: 'nu30', nodes: 4000, k: 9, key: 'sq' });
omega(sq, 24).forEach((w, i) => check(Math.abs(w / SQUARE[i] - 1) < 0.04, `square mode ${i + 1}: ${w.toFixed(2)} vs ${SQUARE[i]}`));
const dc = S.solve({ shape: 'circle', bracing: 'none', bc: 'free', material: 'nu33', nodes: 4000, k: 9, key: 'dc' });
omega(dc, 12).forEach((w, i) => check(Math.abs(w / DISC[i] - 1) < 0.04, `disc mode ${i + 1}: ${w.toFixed(2)} vs ${DISC[i]}`));
// (d, c) labels of the disc: (2,0) (2,0) (0,1) (3,0) (3,0) (1,1) (1,1) (4,0) (4,0)
const DC = [[2, 0], [2, 0], [0, 1], [3, 0], [3, 0], [1, 1], [1, 1], [4, 0], [4, 0]];
dc.info.forEach((f, i) => check(f.d === DC[i][0] && f.c === DC[i][1], `disc mode ${i + 1} label (${f.d}, ${f.c}) vs (${DC[i]})`));
check(sq.info[2].rings === 1 && sq.info[2].lines === 1, `square mode 3 is one closed ring (lines ${sq.info[2].lines})`);

for (const id of P.ORDER) {
  const sh = P.SHAPES[id], t0 = Date.now();
  const r = S.solve({ shape: id, bracing: 'none', bc: 'free', arch: sh.arch || 0, material: sh.material, nodes: 5200, k: 24, key: id });
  const worst = Math.max(...r.info.map(f => f.resid));
  const rising = Array.from(r.lambda).every((l, i, a) => l > 0 && (i === 0 || l >= a[i - 1]));
  check(r.lambda.length === 24 && rising && worst < 1e-6, `${id}: 24 modes, rising, worst residual ${worst.toExponential(1)}, ${Date.now() - t0} ms`);
}
const cl = S.solve({ shape: 'guitar', bracing: 'x', bc: 'clamped', material: 'spruce', nodes: 3000, k: 8, key: 'cl' });
check(cl.lambda[0] > 0 && cl.info.length === 8, `guitar, X braces, clamped edge: 8 modes, first lambda ${cl.lambda[0].toExponential(2)}`);

console.log(fail ? `${fail} FAILED` : 'all passed');
process.exitCode = fail ? 1 : 0;
