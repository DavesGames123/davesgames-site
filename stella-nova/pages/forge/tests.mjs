// ============================================================================
//  PLANET FORGE  ·  tests.mjs — node tests for the pure modules
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/forge/tests.mjs
//  Each check prints one line. The process exits 1 if a check fails.
// ============================================================================
import * as N from './noise.js';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!cond) fails++; };

// noise: determinism, range, gradient, seed independence
{
  const pts = []; const r = N.mulberry(99);
  for (let i = 0; i < 2000; i++) pts.push([r() * 20 - 10, r() * 20 - 10, r() * 20 - 10]);
  const a = pts.map(p => N.simplex3(p[0], p[1], p[2], 7)), b = pts.map(p => N.simplex3(p[0], p[1], p[2], 7));
  ok('noise: same seed gives same values', a.every((v, i) => v === b[i]));
  const c = pts.map(p => N.simplex3(p[0], p[1], p[2], 8));
  ok('noise: another seed gives other values', a.filter((v, i) => v !== c[i]).length > 1900);
  const mx = Math.max(...a.map(Math.abs));
  ok('noise: range within [-1, 1]', mx <= 1, `max |n| ${mx.toFixed(3)}`);
  let ge = 0; const g = [0, 0, 0], h = 1e-5;
  for (const p of pts.slice(0, 300)) {
    N.simplex3(p[0], p[1], p[2], 3, g);
    for (let k = 0; k < 3; k++) { const q = [...p], s = [...p]; q[k] += h; s[k] -= h; ge = Math.max(ge, Math.abs((N.simplex3(...q, 3) - N.simplex3(...s, 3)) / (2 * h) - g[k])); }
  }
  ok('noise: analytic gradient matches finite differences', ge < 1e-5, `max err ${ge.toExponential(1)}`);
  // continuity: no steps (kernel r^2 = 0.5 stays inside the simplex)
  let jump = 0;
  for (let i = 0; i < 200000; i++) { const x = i * 0.0001; jump = Math.max(jump, Math.abs(N.simplex3(x, 0.37, 0.71, 5) - N.simplex3(x + 0.0001, 0.37, 0.71, 5))); }
  ok('noise: continuous along a line (no kernel steps)', jump < 0.002, `max step ${jump.toExponential(1)}`);
  const o = { freq: 2, octaves: 6.5, lacunarity: 2, gain: 0.5 };
  const f1 = pts.map(p => N.fbm(p.map(v => v / 10), o, 4)), f2 = pts.map(p => N.fbm(p.map(v => v / 10), o, 4));
  ok('fbm: deterministic, bounded', f1.every((v, i) => v === f2[i] && Math.abs(v) < 1.5));
  const rr = pts.map(p => N.ridged(p.map(v => v / 10), o, 4, 2));
  ok('ridged: in [0, 1]', rr.every(v => v >= 0 && v <= 1));
  const er = pts.map(p => N.fbmEroded(p.map(v => v / 10), o, 4, 2));
  ok('eroded fbm: finite, bounded', er.every(v => Number.isFinite(v) && Math.abs(v) < 1.5));
  // curl is tangent to the sphere
  let tan = 0; const v = [0, 0, 0];
  for (let i = 0; i < 500; i++) { const p = N.onSphere(r); N.curl(p, 3, 1, v); tan = Math.max(tan, Math.abs(v[0] * p[0] + v[1] * p[1] + v[2] * p[2]) / (Math.hypot(...v) + 1e-9)); }
  ok('curl: tangent to the sphere', tan < 1e-9, `max |v.p|/|v| ${tan.toExponential(1)}`);
  // texel directions: date line columns meet, poles near +-y
  const W = 64, H = 32, L = N.texelDir(0, 10, W, H), R = N.texelDir(W - 1, 10, W, H), M = N.texelDir(W / 2, 10, W, H);
  ok('texelDir: first and last column are neighbours', Math.hypot(L[0] - R[0], L[1] - R[1], L[2] - R[2]) < Math.hypot(L[0] - M[0], L[1] - M[1], L[2] - M[2]) / 10);
  ok('texelDir: row 0 is near the north pole', N.texelDir(5, 0, W, H)[1] > 0.99);
}

// @@MORE@@

console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
