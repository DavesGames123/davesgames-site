// ============================================================================
//  MANUAL GEARBOX  ·  tests.mjs — node stella-nova/pages/manual-gearbox/tests.mjs
// ----------------------------------------------------------------------------
//  Checks box.js:
//    centres ...... every pair has the same centre distance CD = M (Na + Nb)/2
//    ratios ....... 1st > 2nd > 3rd > 4th = 1 > 5th, and the known values
//    mesh ......... at every pair contact, the nearest tooth of one gear sits
//                   half a pitch from the nearest tooth of the other, as arcs
//                   on the pitch circles, at 500 input angles
//    roll ......... the pitch-line speeds of each pair match (finite step)
//    overlap ...... the real involute outlines (teeth.js) of each pair, placed
//                   at their centres and angles, never cross
//    sleeves ...... a sleeve at full travel covers the dog ring of its gear
//                   and no other; in neutral it covers none
// ============================================================================
import { SPEC, GEARS, M, CD, ratio, angles, sleeveX, TAU } from './box.js';
import { outline } from './teeth.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } };
const near = (a, b, e) => Math.abs(a - b) <= e;
const pairs = [['in', SPEC.input.N, SPEC.layIn.N], ...Object.entries(SPEC.pairs).map(([g, p]) => [g, p.main, p.lay])];

for (const [g, a, b] of pairs) ok(near(M * (a + b) / 2, CD, 1e-12), `pair ${g}: centre distance`);
ok(ratio(1) > ratio(2) && ratio(2) > ratio(3) && ratio(3) > ratio(4) && ratio(4) === 1 && ratio(5) < 1, 'ratios in order');
ok(near(ratio(1), 3.0, 1e-12) && near(ratio(2), 2.1, 1e-12) && near(ratio(3), 1.5, 1e-12), 'ratios 3.0, 2.1, 1.5');

// mesh phase: angle from the contact line to the nearest tooth, as an arc
const arcOff = (th, N) => { const p = TAU / N; let x = ((th % p) + p) % p; if (x > p / 2) x -= p; return x * M * N / 2; };
let worst = 0, roll = 0;
for (let i = 0; i < 500; i++) {
  const th = i * 0.0731, A = angles(th), B = angles(th + 1e-6);
  // input (main side) vs layIn: main tooth at contact when angle = 0 (mod pitch)
  // the nearest teeth of a pair in mesh sit half a pitch apart on the arc
  const chk = (am, Nm, al, Nl) => {
    const s = arcOff(am, Nm) + arcOff(al, Nl);
    worst = Math.max(worst, Math.min(Math.abs(s - Math.PI * M / 2), Math.abs(s + Math.PI * M / 2)));
  };
  chk(A.input, SPEC.input.N, A.lay, SPEC.layIn.N);
  for (const g in SPEC.pairs) chk(A.main[g], SPEC.pairs[g].main, A.lay, SPEC.pairs[g].lay);
  // roll: pitch line speeds equal and opposite
  roll = Math.max(roll, Math.abs((B.input - A.input) * SPEC.input.N + (B.lay - A.lay) * SPEC.layIn.N) / 1e-6);
  for (const g in SPEC.pairs) roll = Math.max(roll, Math.abs((B.main[g] - A.main[g]) * SPEC.pairs[g].main + (B.lay - A.lay) * SPEC.pairs[g].lay) / 1e-6);
}
ok(worst < 1e-6, `mesh: tooth faces gap at every contact (worst ${worst.toExponential(2)} mm)`);
ok(roll < 1e-4, `roll: pitch speeds match (worst ${roll.toExponential(2)})`);

// overlap: the real outlines never cross. Main gear centre (0, 0), tooth 0
// toward -y; lay gear centre (0, -CD), tooth 0 toward +y.
const xy = (N, th, cx, cy, dir) => outline(N, N, M, { ha: 1, hf: 1.25 }).map(([r, p]) => { const a = dir + th + p; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
function inside(pt, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; }
let hits = 0;
for (let i = 0; i < 40; i++) {
  const A = angles(i * 0.0377);
  // both gears spin about +x; seen from +x, angles run counter-clockwise in
  // (z, y)... use the plane (y-up, z): main tooth 0 at -y is angle -pi/2
  const test = (am, Nm, al, Nl) => {
    const P = xy(Nm, am, 0, 0, -Math.PI / 2), Q = xy(Nl, al, 0, -CD, Math.PI / 2);
    for (const p of P) if (Math.hypot(p[0], p[1] + CD) < Nl * M / 2 + 1.3 * M && inside(p, Q)) hits++;
  };
  test(A.input, SPEC.input.N, A.lay, SPEC.layIn.N);
  for (const g in SPEC.pairs) test(A.main[g], SPEC.pairs[g].main, A.lay, SPEC.pairs[g].lay);
}
ok(hits === 0, `overlap: no tooth of one gear inside the other (${hits} hits)`);

// sleeves: dog rings sit on the hub side of each gear, 4 mm wide
const dog = { 4: [18, 22], 3: [46, 50], 2: [92, 96], 1: [120, 124], 5: [168, 172] };
for (const G of [{ g: 0 }, ...GEARS]) {
  const sx = sleeveX(G.g), covered = [];
  for (const [h, H] of Object.entries(SPEC.hubs)) {
    const a = H.x - H.w / 2 + sx[h], b = H.x + H.w / 2 + sx[h];
    for (const [g, [d0, d1]] of Object.entries(dog)) if (a < d1 - 0.5 && b > d0 + 0.5) covered.push(+g);
  }
  ok(G.g ? covered.length === 1 && covered[0] === G.g : covered.length === 0, `sleeves in gear ${G.g || 'N'}: cover ${JSON.stringify(covered)}`);
}
console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
