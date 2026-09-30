// ============================================================================
//  HYDROGEN TABLE  ·  rotation check  (Node:  node rotate.test.mjs)
// ----------------------------------------------------------------------------
//  1. At the identity pose, fillTileRot must give the same field as
//     fillTile: equal for real tiles, equal in |psi| for complex tiles.
//  2. A turn of 90 deg about z moves p_x onto p_y: the x-y cut of real
//     2p (m = +1) turned by Rz(90) must match 2p (m = -1) not turned.
//  3. The turned field stays in [-1, 1].
//  Exit code 1 on a failure.
// ============================================================================
import { tileSpec, fillTile, fillTileRot, poseMatrix, startNorm, tileList } from './physics.js';

let fail = 0;
const N = 96, I = poseMatrix(0, 0, 0);
for (const kind of ['complex', 'real']) {
  let worst = 0;
  for (const t of tileList(5, kind)) {
    const S = tileSpec(t.n, t.l, t.m, kind), a = new Float32Array(N * N), b = new Float32Array(N * N);
    const peak = fillTile({ ...S }, N, a);
    fillTileRot(S, N, b, I, peak);
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs((kind === 'complex' ? Math.abs(a[i]) : a[i]) - (kind === 'complex' ? Math.abs(b[i]) : b[i])));
  }
  const ok = worst < 2e-3;
  console.log(`identity pose, ${kind}, n <= 5: max |diff| = ${worst.toExponential(2)}  ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) fail++;
}
{
  const px = tileSpec(2, 1, 1, 'real'), py = tileSpec(2, 1, -1, 'real');
  // Cut both in the x-y plane: the same basis for both.
  for (const S of [px, py]) { S.ex = [1, 0, 0]; S.ey = [0, 1, 0]; }
  const a = new Float32Array(N * N), b = new Float32Array(N * N);
  const pk = startNorm(px).peak;
  fillTileRot(px, N, a, poseMatrix(0, 0, 90), pk);
  fillTileRot(py, N, b, I, pk);
  let worst = 0; for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  const ok = worst < 2e-3;
  console.log(`Rz(90) p_x == p_y in the x-y plane: max |diff| = ${worst.toExponential(2)}  ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) fail++;
}
{
  let lo = 0, hi = 0;
  for (const t of tileList(6, 'real')) {
    const S = tileSpec(t.n, t.l, t.m, 'real'), f = new Float32Array(64 * 64);
    fillTileRot(S, 64, f, poseMatrix(37, 71, 113), startNorm(S).peak);
    for (const v of f) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  const ok = lo >= -1 && hi <= 1;
  console.log(`turned field range, real n <= 6: [${lo.toFixed(3)}, ${hi.toFixed(3)}]  ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
