// ============================================================================
//  MUJOCO LAB  ·  core/tests.mjs — node checks of the core, no browser
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/mujoco-lab/core/tests.mjs [--write]
//  --write puts the step-time table into CONTRACT.md (between the STEPTIMES
//  markers).
//
//  GREP MAP
//    section('library ....... every model loads and steps 2 s, finite state
//    section('procedural .... seeded scenes: same seed, same text; all step
//    section('energy ........ frictionless double pendulum, RK4 vs Euler
//    section('bounce ........ restitution from solref damping
//    section('contact ....... contact forces of a resting box sum to m g
//    section('perturb ....... the mouse spring and applyForce move a body
//    section('options ....... run-time option changes take effect
//    section('control ....... keyframes, actuators, sensors, equalities
//    section('dispose ....... heap does not grow over 50 load/dispose cycles
//    section('data .......... model entries, credits, explainer citations
// ============================================================================
import { readFile, writeFile, access } from 'node:fs/promises';
import { loadMuJoCo, createSim, heapBytes, INTEGRATORS, SOLVERS, CONES } from './engine.js';
import { MODELS, GROUPS, loadModel, modelByKey } from './models.js';
import { generate, KINDS } from './procedural.js';
import { STEPS, INTEGRATORS as EXI, SOLVERS as EXS, CITATIONS } from './explain.js';

const here = new URL('./', import.meta.url);
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log('  FAIL', msg); } };
const section = n => console.log(`\n── ${n}`);
const finite = a => { for (const v of a) if (!Number.isFinite(v)) return false; return true; };
const mj = await loadMuJoCo();
const box = (extra = '', opt = '') => `<mujoco><option timestep="0.002"${opt}/><worldbody><geom name="floor" type="plane" size="2 2 .1"/>
  <body name="box" pos="0 0 .1"><freejoint/><geom type="box" size=".1 .1 .1" mass="2"/></body>${extra}</worldbody></mujoco>`;

section('library: every model loads and steps 2 s with finite state');
const times = [];
for (const e of MODELS) {
  let S;
  try { S = await loadModel(mj, e); } catch (err) { ok(false, `${e.key} load: ${err.message}`); continue; }
  const dt = S.m.opt.timestep, n = Math.round(2 / dt);
  S.step(Math.min(n, 50));                    // warm the WASM tiers
  const t0 = performance.now(); S.step(n - Math.min(n, 50)); const ms = (performance.now() - t0) / Math.max(1, n - 50);
  const fin = finite(S.qpos) && finite(S.qvel);
  ok(fin, `${e.key} state not finite after 2 s`);
  ok(Math.abs(S.time - n * dt) < 1e-9, `${e.key} time ${S.time}`);
  ok(S.contacts().every(c => finite(c.force)), `${e.key} contact forces finite`);
  times.push({ key: e.key, nbody: S.nbody, nv: S.nv, dt, ms, rt: dt * 1000 / ms, heavy: !!e.heavy });
  console.log(`  ${e.key.padEnd(16)} nbody ${String(S.nbody).padStart(3)} nv ${String(S.nv).padStart(3)} dt ${String(dt).padEnd(6)} ${ms.toFixed(3)} ms/step  x${(dt * 1000 / ms).toFixed(1)} real time${fin ? '' : '  NOT FINITE'}`);
  S.dispose();
}
ok(MODELS.length >= 15, `library has ${MODELS.length} models (need 15)`);

section('procedural: seeded scenes');
for (const k of Object.keys(KINDS)) {
  const a = generate(k, 11), b = generate(k, 11), c = generate(k, 12);
  ok(a.xml === b.xml, `${k}: same seed gives the same XML`);
  ok(a.xml !== c.xml, `${k}: another seed gives another XML`);
  const S = createSim(mj, a); S.step(500);
  ok(finite(S.qpos), `${k} seed 11 finite`);
  console.log(`  ${k.padEnd(9)} seed 11: nbody ${S.nbody}, 1 s finite ${finite(S.qpos)}`);
  S.dispose();
}

section('energy: frictionless double pendulum, 10 s');
{
  const drift = {};
  for (const integ of ['RK4', 'Euler']) {
    const S = await loadModel(mj, 'double-pendulum'); S.setOptions({ integrator: integ });
    const e0 = S.energy(), E0 = e0[0] + e0[1];
    let worst = 0;
    for (let i = 0; i < 100; i++) { S.step(100); const e = S.energy(); worst = Math.max(worst, Math.abs(e[0] + e[1] - E0)); }
    const scale = Math.abs(e0[0]) || 1;
    drift[integ] = worst / scale;
    console.log(`  ${integ.padEnd(5)} E0 = ${E0.toFixed(6)} J, max |E - E0| / |V0| = ${drift[integ].toExponential(2)}`);
    S.dispose();
  }
  ok(drift.RK4 < 1e-5, `RK4 energy drift ${drift.RK4}`);
  ok(drift.Euler > 10 * drift.RK4, `Euler drift ${drift.Euler} should be much larger than RK4 ${drift.RK4}`);
}

section('bounce: solref damping sets the restitution');
{
  const S = await loadModel(mj, 'bounce'), names = ['elastic', 'lively', 'dead'];
  const ids = names.map(n => S.bodyNames.indexOf(n)), r = 0.05, h0 = 1 - r;
  const peak = names.map(() => 0), hit = names.map(() => false);
  for (let i = 0; i < 4000; i++) {
    S.step(1);
    ids.forEach((b, k) => { const z = S.xpos[3 * b + 2]; if (z < r + 0.01) hit[k] = true; else if (hit[k] && S.qvel[6 * k + 2] < 0 && peak[k] === 0) peak[k] = z - r; });
  }
  const e = peak.map(p => Math.sqrt(p / h0));
  // damped spring: zeta = b / (2 sqrt(k)), e = exp(-pi zeta / sqrt(1 - zeta^2))
  const theory = [0, 10, 100].map(b => { const z = b / (2 * Math.sqrt(20000)); return Math.exp(-Math.PI * z / Math.sqrt(1 - z * z)); });
  names.forEach((n, k) => console.log(`  ${n.padEnd(8)} first rebound ${peak[k].toFixed(3)} m of ${h0} m, restitution ${e[k].toFixed(3)} (spring-damper ${theory[k].toFixed(3)})`));
  ok(e[0] > 0.97, `elastic restitution ${e[0]}`);
  ok(e[0] > e[1] && e[1] > e[2] && e[2] < 0.5, `restitution order ${e}`);
  // light damping only: with heavy damping a contact cannot pull, so it lets go
  // before the half cycle ends and the ball keeps more energy than the formula says
  [0, 1].forEach(k => ok(Math.abs(e[k] - theory[k]) < 0.02, `${names[k]} restitution ${e[k]} vs spring-damper ${theory[k]}`));
  S.dispose();
}

section('contact: a resting box, sum of contact forces = m g');
for (const [solver, cone] of [['Newton', 'pyramidal'], ['Newton', 'elliptic'], ['PGS', 'pyramidal'], ['CG', 'elliptic']]) {
  const S = createSim(mj, { xml: box() }); S.setOptions({ solver, cone }); S.step(1000);
  const C = S.contacts(), fz = C.reduce((s, c) => s + c.force[2], 0), w = S.totalMass() * 9.81;
  const nup = C.every(c => c.normal[2] > 0.99);
  console.log(`  ${solver.padEnd(6)} ${cone.padEnd(9)} ${C.length} contacts, sum Fz ${fz.toFixed(5)} N, m g ${w.toFixed(5)} N`);
  ok(Math.abs(fz - w) / w < 1e-3, `${solver}/${cone} contact force ${fz} vs ${w}`);
  ok(C.length >= 4 && nup, `${solver}/${cone} contacts ${C.length}, normals up ${nup}`);
  S.dispose();
}

section('perturb: the mouse spring and applyForce move a body');
{
  const S = createSim(mj, { xml: box() }); S.step(200);
  const b = S.bodyNames.indexOf('box'), p0 = Array.from(S.xpos.slice(3 * b, 3 * b + 3));
  const local = [0.1, 0, 0.1], target = [p0[0] + 0.5, p0[1], p0[2] + 0.4];
  S.perturb(b, local, target); S.step(1000);
  const tip = S.pointWorld(b, local), d = Math.hypot(tip[0] - target[0], tip[1] - target[1], tip[2] - target[2]);
  console.log(`  spring: grab point ${d.toFixed(3)} m from the target after 2 s (start ${Math.hypot(0.5, 0, 0.4).toFixed(3)} m)`);
  // the spring is 100 k per kg, so gravity alone leaves a sag of g / 100 = 0.098 m
  ok(d < 0.15, `perturb did not pull the body to the target: ${d}`);
  S.clearPerturb(); ok(S.d.xfrc_applied.every(v => v === 0), 'clearPerturb zeroes xfrc_applied');
  S.reset(); S.step(100);
  const x0 = S.xpos[3 * b];
  for (let i = 0; i < 250; i++) { S.applyForce(b, [0, 0, 40]); S.step(1); }
  console.log(`  applyForce 40 N up on 2 kg for 0.5 s: z ${S.xpos[3 * b + 2].toFixed(3)} m`);
  ok(S.xpos[3 * b + 2] > 0.3 && Math.abs(S.xpos[3 * b] - x0) < 1e-3, 'applyForce lifts the box');
  S.dispose();
}

section('options: run-time changes take effect');
{
  const S = createSim(mj, { xml: box('<body name="ball" pos="1 0 1"><freejoint/><geom type="sphere" size=".05" mass=".1"/></body>') });
  const ball = S.bodyNames.indexOf('ball');
  for (const i of INTEGRATORS) ok(S.setOptions({ integrator: i }).integrator === i, `integrator ${i}`);
  for (const s of SOLVERS) ok(S.setOptions({ solver: s }).solver === s, `solver ${s}`);
  for (const c of CONES) ok(S.setOptions({ cone: c }).cone === c, `cone ${c}`);
  const o = S.setOptions({ iterations: 7, tolerance: 1e-5, noslip: 3, impratio: 4, density: 1.2, viscosity: 2e-5, substeps: 3 });
  ok(o.iterations === 7 && o.tolerance === 1e-5 && o.noslip === 3 && o.impratio === 4 && o.density === 1.2 && o.viscosity === 2e-5 && S.substeps === 3, 'scalar options read back');
  S.setOptions({ integrator: 'Euler', solver: 'Newton', cone: 'pyramidal', iterations: 100, tolerance: 1e-8, noslip: 0, density: 0, viscosity: 0, substeps: 1 });
  S.setOptions({ gravity: [0, 0, 0] }); S.step(500);
  ok(Math.abs(S.xpos[3 * ball + 2] - 1) < 1e-9, `gravity 0: ball stays at z 1 (${S.xpos[3 * ball + 2]})`);
  S.setOptions({ gravity: [0, 0, -9.81], timestep: 0.001 }); const t = S.time; S.step(100);
  ok(Math.abs(S.time - t - 0.1) < 1e-9, 'timestep 0.001: 100 steps = 0.1 s');
  // wind needs a medium: density 1000 (water) and wind 2 m/s along x
  S.reset(); S.setOptions({ gravity: [0, 0, 0], density: 1000, wind: [2, 0, 0], timestep: 0.002 }); S.step(500);
  const vx = S.qvel[6 + 0];
  console.log(`  wind 2 m/s in a dense medium: ball vx ${vx.toFixed(3)} m/s after 1 s`);
  ok(vx > 0.5, `wind moves the ball: vx ${vx}`);
  S.reset(); S.setOptions({ wind: [0, 0, 0], density: 0, viscosity: 0, gravity: [0, 0, -9.81] });
  S.qvel[6] = 1; S.forward(); S.setOptions({ viscosity: 50 }); S.step(250);
  console.log(`  viscosity 50: ball vx from 1 to ${S.qvel[6].toFixed(3)} m/s in 0.5 s`);
  ok(S.qvel[6] < 0.5, `viscosity slows the ball: ${S.qvel[6]}`);
  S.dispose();
  // noslip removes slip of a box on a slope with friction
  const slope = `<mujoco><option timestep="0.004"/><worldbody><geom type="plane" size="2 2 .1" euler="0 10 0" friction=".5"/>
    <body pos="0 0 .12"><freejoint/><geom type="box" size=".1 .1 .1" mass="1" friction=".5"/></body></worldbody></mujoco>`;
  const slip = {};
  for (const ns of [0, 10]) { const T = createSim(mj, { xml: slope }); T.setOptions({ noslip: ns }); T.step(250); const x0 = T.xpos[3]; T.step(500); slip[ns] = Math.abs(T.xpos[3] - x0); T.dispose(); }
  console.log(`  box on a 10 degree slope, mu 0.5, 2 s: creep ${slip[0].toExponential(2)} m (noslip 0), ${slip[10].toExponential(2)} m (noslip 10)`);
  ok(slip[10] < slip[0], 'noslip iterations reduce creep');
}

section('control: keyframes, actuators, sensors, equalities');
{
  const C = await loadModel(mj, 'cartpole');
  ok(Math.abs(C.qpos[1] - 0.05) < 1e-12, `cartpole starts at its keyframe (${C.qpos[1]})`);
  C.setCtrl('push', 5); ok(C.d.ctrl[0] === 1, 'setCtrl clamps to ctrlrange');
  C.step(250); C.forward(); ok(C.qpos[0] > 0.1, `motor pushes the cart (${C.qpos[0].toFixed(3)} m)`);
  ok(C.sensors()[0].name === 'cart x' && Math.abs(C.sensors()[0].value[0] - C.qpos[0]) < 1e-12, 'jointpos sensor = qpos');
  C.dispose();
  const G = await loadModel(mj, 'gears');
  G.setCtrl('drive', 2); G.step(1000);
  const s = Object.fromEntries(G.sensors().map(x => [x.name, x.value[0]]));
  console.log(`  gears after 2 s: a ${s.a.toFixed(3)} rad, b ${s.b.toFixed(3)} rad (b / a = ${(s.b / s.a).toFixed(4)}), slider ${s.slide.toFixed(3)} m`);
  ok(Math.abs(s.a) > 0.5 && Math.abs(s.b / s.a + 2) < 0.02, `gear ratio ${s.b / s.a}`);
  G.dispose();
  const T = await loadModel(mj, 'tippe-top');
  ok(Math.abs(T.qvel[5] - 200) < 1e-9, 'tippe top starts spinning at 200 rad/s');
  T.dispose();
}

section('dispose: heap does not grow over 50 load/dispose cycles');
{
  const cycle = async key => { const S = await loadModel(mj, key); S.step(50); S.contacts(); S.sensors(); S.geomPoses(); S.dispose(); };
  const keys = ['panda', 'humanoid', 'cloth', 'balls-in-box'];
  for (const k of keys) await cycle(k);         // warm-up
  const big = `<mujoco><size memory="24M"/><worldbody><body><freejoint/><geom size=".1"/></body></worldbody></mujoco>`;
  for (let i = 0; i < 3; i++) createSim(mj, { xml: big }).dispose();
  const h0 = heapBytes();
  for (let i = 0; i < 50; i++) { await cycle(keys[i % keys.length]); createSim(mj, { xml: big }).dispose(); }
  const h1 = heapBytes();
  console.log(`  heap ${(h0 / 2 ** 20).toFixed(1)} MiB before, ${(h1 / 2 ** 20).toFixed(1)} MiB after 50 cycles (each with a 24 MiB arena model)`);
  ok(h0 > 0 && h1 === h0, `heap grew from ${h0} to ${h1}`);
  // control: the probe sees a leak (5 models of 24 MiB that are not disposed)
  const leak = []; for (let i = 0; i < 5; i++) leak.push(createSim(mj, { xml: big }));
  const h2 = heapBytes(); leak.forEach(S => S.dispose());
  console.log(`  control: 5 models kept alive -> heap ${(h2 / 2 ** 20).toFixed(1)} MiB`);
  ok(h2 > h1, 'heap probe detects a leak');
  const S = createSim(mj, { xml: box() }); S.dispose(); S.dispose(); ok(S.disposed, 'dispose twice is safe');
}

section('data: model entries, credits, explainer');
{
  const credits = await readFile(new URL('CREDITS.md', here), 'utf8');
  const keys = new Set();
  for (const e of MODELS) {
    ok(!keys.has(e.key), `duplicate key ${e.key}`); keys.add(e.key);
    ok(e.name && e.blurb && GROUPS.includes(e.group), `${e.key} name, blurb, group`);
    ok(e.camera && e.camera.lookat.length === 3 && e.camera.distance > 0, `${e.key} camera`);
    ok(e.source && e.source.licence && e.source.name, `${e.key} source and licence`);
    if (e.source.licenceFile) { let has = true; try { await access(new URL(e.source.licenceFile, here)); } catch { has = false; } ok(has, `${e.key} licence file ${e.source.licenceFile}`); }
    if (e.load) ok(credits.includes(e.load.dir.replace('models/', '').replace(/\/$/, '')) || e.load.dir === 'models/lab/', `${e.key}: ${e.load.dir} in CREDITS.md`);
  }
  ok(modelByKey('humanoid') && !modelByKey('nope'), 'modelByKey');
  const ids = new Set(CITATIONS.map(c => c.id));
  for (const s of [...STEPS, ...EXI, ...EXS]) for (const c of s.cite) ok(ids.has(c), `citation ${c} of ${s.id || s.key}`);
  ok(EXI.map(x => x.key).join() === INTEGRATORS.join(), 'explainer integrators = engine integrators');
  ok(CITATIONS.every(c => c.url), 'every citation has a URL');
}

// ── step-time table ─────────────────────────────────────────────────────────
const table = ['| Model | bodies | dofs | timestep (s) | ms per step | x real time |', '|---|---:|---:|---:|---:|---:|',
  ...times.map(t => `| ${t.key}${t.heavy ? ' (heavy)' : ''} | ${t.nbody} | ${t.nv} | ${t.dt} | ${t.ms.toFixed(3)} | ${t.rt.toFixed(1)} |`)].join('\n');
if (process.argv.includes('--write')) {
  const p = new URL('CONTRACT.md', here); let s = await readFile(p, 'utf8');
  const block = `<!-- STEPTIMES -->\n${table}\n\nMeasured ${new Date().toISOString().slice(0, 10)}, node ${process.version}, ${process.platform} ${process.arch}, single thread. Other jobs ran on the machine, and two runs can differ by up to 5 times; use the column to rank models, not as a budget.\n<!-- /STEPTIMES -->`;
  s = /<!-- STEPTIMES -->[\s\S]*<!-- \/STEPTIMES -->/.test(s) ? s.replace(/<!-- STEPTIMES -->[\s\S]*<!-- \/STEPTIMES -->/, block) : s.trimEnd() + '\n\n' + block + '\n';
  await writeFile(p, s); console.log('\n  step times written to CONTRACT.md');
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
