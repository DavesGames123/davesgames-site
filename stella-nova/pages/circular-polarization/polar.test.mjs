// CIRCULAR POLARIZATION · polar.test.mjs — node polar.test.mjs
// Checks polState and jonesText against the field E = cos φ ê1 + cos(φ−δ) ê2
// with φ = k·r − ω·t, by stepping time and measuring the turn directly.
import { polState, jonesText } from './polar.js';
let fail = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); if (!ok) fail++; };
// turn sign measured from the field: z of E(t) × E(t+dt), seen from +û_r
// (ê1 right, ê2 up). Negative z = clockwise as seen by the receiver.
function measuredTurn(delta) {
  const d = delta * Math.PI / 180, E = t => [Math.cos(-t), Math.cos(-t - d)];
  let z = 0; for (let i = 0; i < 64; i++) { const t = i / 10, a = E(t), b = E(t + 1e-3); z += a[0] * b[1] - a[1] * b[0]; }
  return Math.abs(z) < 1e-6 ? 0 : (z < 0 ? 1 : -1);   // +1 = clockwise
}
for (const d of [-180, -135, -90, -45, 0, 30, 45, 90, 135, 180]) {
  const st = polState(d);
  check(`turn sign δ=${d}`, st.turn === measuredTurn(d), `polState ${st.turn}, measured ${measuredTurn(d)}`);
}
check('δ=90 circular, χ=45', polState(90).kind === 'circular' && Math.abs(polState(90).chi - 45) < 1e-9);
check('δ=-90 circular, χ=-45', polState(-90).kind === 'circular' && Math.abs(polState(-90).chi + 45) < 1e-9);
check('δ=0 linear, ψ=+45', polState(0).kind === 'linear' && polState(0).psi === 45);
check('δ=180 linear, ψ=-45', polState(180).kind === 'linear' && polState(180).psi === -45);
check('δ=45 elliptical, χ=22.5', polState(45).kind === 'elliptical' && Math.abs(polState(45).chi - 22.5) < 1e-9);
// axial ratio from the traced ellipse equals tan|χ|
for (const d of [30, 45, 60, 120]) {
  const dl = d * Math.PI / 180; let mx = 0, mn = 1e9;
  for (let i = 0; i < 20000; i++) { const s = i / 20000 * Math.PI * 2, r = Math.hypot(Math.cos(s), Math.cos(s - dl)); mx = Math.max(mx, r); mn = Math.min(mn, r); }
  const ar = mn / mx, chi = polState(d).chi * Math.PI / 180;
  check(`axial ratio δ=${d}`, Math.abs(ar - Math.tan(Math.abs(chi))) < 1e-4, `traced ${ar.toFixed(5)}, tan|χ| ${Math.tan(Math.abs(chi)).toFixed(5)}`);
}
for (const [d, want] of [[90, '(1, −i)/√2'], [-90, '(1, i)/√2'], [0, '(1, 1)/√2'], [180, '(1, −1)/√2'], [45, '(1, 0.71 − 0.71i)/√2']]) {
  check(`jones δ=${d}`, jonesText(d) === want, jonesText(d));
}
console.log(fail ? `${fail} failed` : 'all passed');
process.exit(fail ? 1 : 0);
