// engine_test.js - checks engine.js without a browser.
//   deno run -A pages/lenia/tools/engine_test.js
//
// Test 1: one step of the GPU engine against reference_step.py (numpy FFT, the
//   method of Chan's LeniaND.py) on a random 72 x 40 world, for every kernel
//   core, every growth function and a 3-ring kernel. The world is not square,
//   so a swap of x and y fails the test.
// Test 2: Orbium unicaudatus, from Chan's animals.json, runs 2000 steps. It
//   must keep its mass and move.
import { createEngine } from '../engine.js';

const here = new URL('.', import.meta.url).pathname;
const engine = await createEngine(null);
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };

// ---- test 1
const W = 72, H = 40;
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const cases = [];
const rules = [
  { R: 9, T: 10, m: 0.15, s: 0.015, b: [1], kn: 1, gn: 1 },
  { R: 9, T: 10, m: 0.15, s: 0.015, b: [1], kn: 2, gn: 2 },
  { R: 7, T: 5, m: 0.26, s: 0.036, b: [1], kn: 3, gn: 3 },
  { R: 7, T: 1, m: 0.35, s: 0.07, b: [1], kn: 4, gn: 3 },
  { R: 12, T: 10, m: 0.26, s: 0.036, b: [0.5, 1, 0.667], kn: 1, gn: 1 },
  { R: 15, T: 8, m: 0.2, s: 0.03, b: [1, 0.25], kn: 2, gn: 2 },
];
for (const r of rules) {
  engine.setWorld(W, H);
  engine.setRule(r);
  const data = new Float32Array(W * H);
  for (let i = 0; i < data.length; i++) data[i] = rand() < 0.5 ? rand() : 0;
  engine.stamp({ w: W, h: H, data }, W / 2, H / 2);
  const A0 = await engine.readState();
  engine.step(1);
  const A1 = await engine.readState();
  cases.push({ W, H, ...r, A0: Array.from(A0), A1: Array.from(A1) });
}
const py = new Deno.Command('python3', { args: [here + 'reference_step.py'], stdin: 'piped', stdout: 'piped', stderr: 'inherit' }).spawn();
const w = py.stdin.getWriter();
await w.write(new TextEncoder().encode(JSON.stringify(cases)));
await w.close();
const res = JSON.parse(new TextDecoder().decode((await py.output()).stdout));
res.forEach((r, i) => {
  const c = rules[i];
  check(r.max_err < 2e-5, `step vs numpy FFT  kn=${c.kn} gn=${c.gn} R=${c.R} b=[${c.b}]  max err ${r.max_err.toExponential(2)}` +
    (r.edge_cells ? `  (${r.edge_cells} cells at the step edge skipped)` : ''));
});

// ---- test 2
// Orbium unicaudatus from animals.json, decoded to 0..255 rows by build_creatures.py.
const ORBIUM = JSON.parse(await Deno.readTextFile(here + 'orbium.json'));
engine.setWorld(128, 128);
engine.setRule({ R: 13, T: 10, m: 0.15, s: 0.015, b: [1], kn: 1, gn: 1 });
const pdata = new Float32Array(ORBIUM.w * ORBIUM.h).map((_, i) => ORBIUM.cells[i] / 255);
engine.stamp({ w: ORBIUM.w, h: ORBIUM.h, data: pdata }, 64, 64);
const s0 = await engine.stats();
engine.step(2000);
const s1 = await engine.stats();
const moved = Math.hypot(((s1.cx - s0.cx + 192) % 128) - 64, ((s1.cy - s0.cy + 192) % 128) - 64);
check(s1.mass > 0.8 * s0.mass && s1.mass < 1.25 * s0.mass, `Orbium mass ${s0.mass.toFixed(1)} -> ${s1.mass.toFixed(1)} after 2000 steps`);
check(s1.focus > 0.9, `Orbium stays in one piece (focus ${s1.focus.toFixed(3)})`);
check(moved > 3, `Orbium moves: centroid (${s0.cx.toFixed(1)}, ${s0.cy.toFixed(1)}) -> (${s1.cx.toFixed(1)}, ${s1.cy.toFixed(1)})`);

// ---- speed
engine.setWorld(512, 256);
engine.setRule({ R: 13 });
engine.stamp({ w: 512, h: 256, data: new Float32Array(512 * 256).map(() => Math.random() * 0.5) }, 256, 128);
await engine.readState();
const t0 = performance.now();
engine.step(200);
await engine.readState();
const dt = performance.now() - t0;
console.log(`INFO  512x256, R=13 (${engine.info.taps} taps): ${(200 / dt * 1000).toFixed(0)} steps/s`);

engine.destroy();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
Deno.exit(fails ? 1 : 0);
