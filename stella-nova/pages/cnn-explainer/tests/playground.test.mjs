// CNN Explainer · tests/playground.test.mjs
// The kernel playground maths (output size from size, kernel, stride and
// padding; the small convolution) and the activation functions.
import { playSize, tinyConv, demoInput, edgeKernel, ACTIVATIONS } from '../playground.js';

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) pass++; else { fail++; console.log('FAIL  ' + m + (d ? '  ' + d : '')); } };

// o = floor((n + 2p - k) / s) + 1
const CASES = [
  // n, k, s, p -> o, exact
  [5, 3, 1, 0, 3, true], [5, 3, 1, 1, 5, true], [5, 3, 2, 0, 2, true], [5, 3, 2, 1, 3, true],
  [6, 3, 2, 0, 2, false], [7, 5, 1, 2, 7, true], [7, 2, 2, 0, 3, false], [64, 3, 1, 0, 62, true],
  [60, 2, 2, 0, 30, true], [26, 2, 2, 0, 13, true], [5, 1, 3, 0, 2, false], [4, 5, 1, 0, 0, false],
];
for (const [n, k, s, p, o, exact] of CASES) {
  const r = playSize(n, k, s, p);
  ok(r.o === o && r.exact === exact, `playSize n=${n} k=${k} s=${s} p=${p}`, JSON.stringify(r));
}
ok(playSize(4, 5, 1, 0).valid === false && playSize(4, 5, 1, 1).valid === true, 'a kernel larger than the padded input is not valid');

// tinyConv by hand: 3x3 input 1..9, 2x2 kernel [[1,0],[0,-1]], p 1, s 2
{
  const g = [1, 2, 3, 4, 5, 6, 7, 8, 9], k = [1, 0, 0, -1];
  const r = tinyConv(g, 3, k, 2, 2, 1);
  // windows at padded (0,0) (0,2) (2,0) (2,2); input = padded - 1
  // (0,0): pad, pad / pad, 1 -> 0 - 1 = -1 ; (0,2): pad,pad / 2,3 -> 0 - 3 = -3
  // (2,0): pad,4 / pad,7 -> 0 - 7 = -7    ; (2,2): 5,6 / 8,9 -> 5 - 9 = -4
  ok(r.o === 2 && Array.from(r.out).join(',') === '-1,-3,-7,-4', 'tinyConv padding 1 stride 2', Array.from(r.out).join(','));
  ok(r.windows.length === 4 && r.windows[3].iy === 1 && r.windows[3].ix === 1, 'tinyConv window corners');
  const v = tinyConv(g, 3, [1, 1, 1, 1, 1, 1, 1, 1, 1], 3, 1, 0);
  ok(v.o === 1 && v.out[0] === 45, 'tinyConv 3x3 sum kernel');
}
{
  const n = 7, g = demoInput(n);
  ok(g.length === 49 && Math.max(...g) === 1 && Math.min(...g) === 0, 'demoInput is 0..1');
  const e = edgeKernel(3);
  ok(Array.from(e).join(',') === '1,0,-1,1,0,-1,1,0,-1', 'edgeKernel(3)');
  ok(Array.from(edgeKernel(2)).join(',') === '1,-1,1,-1', 'edgeKernel(2)');
}

// activations
{
  const A = ACTIVATIONS;
  ok(A.relu.f(-2) === 0 && A.relu.f(3) === 3, 'relu');
  ok(Math.abs(A.leaky.f(-2) + 0.2) < 1e-12 && A.leaky.f(2) === 2, 'leaky relu');
  ok(Math.abs(A.sigmoid.f(0) - 0.5) < 1e-12 && A.sigmoid.f(20) > 0.999, 'sigmoid');
  ok(Math.abs(A.tanh.f(1) - 0.7615941559557649) < 1e-12, 'tanh');
  ok(A.none.f(-4.5) === -4.5, 'none');
  ok(Object.values(A).every(a => a.label && a.tex && a.note), 'each activation has a label, TeX and a note');
}

console.log(`playground: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
