// ============================================================================
//  MUJOCO LAB  ·  tests.mjs — node checks of the page layer (no browser)
// ----------------------------------------------------------------------------
//  node stella-nova/pages/mujoco-lab/tests.mjs
//  Covers scenes.js (all kinds compile, same seed same XML, domino runs
//  fall), lab.js (load sources, options kept on reload, drivers in range,
//  rtf, picking with mj_ray, contacts, joints, share link round trip, a
//  bad MJCF keeps the old sim), io.js (highlight, top-file choice, paths)
//  and the main.js module link (a SyntaxError would blank the page).
//  The core has its own tests: core/tests.mjs.
// ============================================================================
import { sceneXML, SCENE_KINDS } from './scenes.js';
import { createLab, encodeShare, decodeShare, cameraRay, checkOption, modelName } from './lab.js';
import { highlightXML, pickMain, rebase } from './io.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// ---- scenes ------------------------------------------------------------------
for (const k of Object.keys(SCENE_KINDS)) {
  const a = sceneXML(k, 42), b = sceneXML(k, 42), c = sceneXML(k, 43);
  ok(a.xml === b.xml, `${k}: same seed, same XML`);
  ok(a.xml !== c.xml, `${k}: other seed, other XML`);
  ok(a.camera && a.camera.lookat.length === 3, `${k}: camera`);
}

const lab = createLab();
await lab.init();
const mj = lab.mj;
for (const k of Object.keys(SCENE_KINDS)) {
  const S = await lab.load({ kind: k, seed: 5 });
  S.step(500);
  ok([...S.qpos].every(Number.isFinite), `${k}: finite after 1 s`);
}
{ // a domino run falls over to the end in 10 s
  const S = await lab.load({ kind: 'dominoes', seed: 3 });
  S.step(5000);
  let fallen = 0;
  for (let b = 1; b < S.nbody; b++) { const q = S.xquat.subarray(4 * b, 4 * b + 4); if (1 - 2 * (q[1] * q[1] + q[2] * q[2]) < 0.7) fallen++; }
  ok(fallen === S.nbody - 1, `dominoes: all fall (${fallen}/${S.nbody - 1})`);
  console.log(`domino run seed 3: ${fallen} of ${S.nbody - 1} fell in 10 s`);
}

// ---- lab: sources, options, drivers --------------------------------------------
{
  let S = await lab.load({ model: 'cartpole' });
  ok(lab.source.model === 'cartpole' && S.nu === 1, 'cartpole loads with one actuator');
  const base = lab.baseOptions;
  lab.setOptions({ integrator: 'implicitfast', gravity: [0, 0, -3], timestep: 0.001 });
  ok(lab.sim.options().integrator === 'implicitfast' && lab.sim.options().gravity[2] === -3, 'options apply');
  ok(Object.keys(lab.overrides).sort().join() === 'gravity,integrator,timestep', 'overrides recorded');
  lab.setOptions({ integrator: base.integrator });
  ok(!('integrator' in lab.overrides), 'setting the model value removes the override');
  // reload edited XML: overrides kept, edit applied
  const xml = lab.source.xml.replace('<mujoco model="', '<mujoco model="edited ');
  S = await lab.reloadXML(xml);
  ok(lab.source.edited && lab.sim.options().gravity[2] === -3 && lab.sim.options().timestep === 0.001, 'reload keeps the overrides');
  // a bad model throws and keeps the old sim
  const before = lab.sim;
  let threw = false;
  try { await lab.reloadXML('<mujoco><worldbody><bogus/></worldbody></mujoco>'); } catch (e) { threw = /unrecognized element/.test(e.message); }
  ok(threw && lab.sim === before && !before.disposed, 'bad MJCF: error message, old sim kept');
  lab.resetOptions();
  ok(Object.keys(lab.overrides).length === 0 && lab.sim.options().gravity[2] === base.gravity[2], 'model defaults restore');

  // drivers stay in ctrlrange
  for (const mode of ['random', 'sine']) {
    await lab.load({ model: 'tendon-arm' });
    lab.setDriver(mode, { amp: 1, freq: 2 });
    let lo = Infinity, hi = -Infinity, moved = 0;
    for (let i = 0; i < 200; i++) {
      lab.frame(1 / 60, { playing: true });
      for (let a = 0; a < lab.sim.nu; a++) { const [x, y] = lab.ctrlBounds(a), v = lab.sim.d.ctrl[a]; lo = Math.min(lo, v - x); hi = Math.max(hi, v - y); if (Math.abs(v) > 1e-3) moved++; }
    }
    ok(lo >= -1e-9 && hi <= 1e-9 && moved > 100, `${mode} driver stays in ctrlrange and moves (${moved})`);
  }
  lab.setDriver('off');

  // real-time factor of a light model is near 1 at speed 1, near 0.25 at 1/4
  await lab.load({ model: 'double-pendulum' });
  for (let i = 0; i < 120; i++) lab.frame(1 / 60, { playing: true, speed: 0.25 });
  near(lab.rtf, 0.25, 0.01, 'rtf at speed 1/4');
  // single step when paused
  const t0 = lab.sim.time;
  lab.frame(1 / 60, { playing: false, single: true });
  near(lab.sim.time - t0, lab.sim.m.opt.timestep, 1e-12, 'single step = one timestep');

  // joints table
  const rows = lab.jointRows();
  ok(rows.length === 2 && rows.every(r => r.type === 'hinge' && r.q.length === 1), 'double pendulum: two hinge rows');
  await lab.load({ model: 'humanoid' });
  const hr = lab.jointRows();
  ok(hr[0].type === 'free' && hr[0].q.length === 7, 'humanoid: free joint row has 7 numbers');
}

// ---- contacts and picking ------------------------------------------------------------
{
  const xml = `<mujoco><worldbody><geom name="floor" type="plane" size="2 2 .1"/><body name="box" pos="0 0 .1"><freejoint/><geom name="cube" type="box" size=".1 .1 .1" mass="2"/></body></worldbody></mujoco>`;
  const S = await lab.load({ xml });
  ok(lab.source.custom && lab.source.name === 'Your model', 'custom source');
  S.step(1000);
  const c = lab.contactInfo();
  ok(c.count >= 4, `resting box has contacts (${c.count})`);
  near(c.normal, 2 * 9.81, 0.05, 'sum of normal forces = m g');
  near(c.total[2], 2 * 9.81, 0.05, 'net world force z = m g');
  // a ray from above hits the box at its top face
  const hit = lab.pick([0.02, 0.01, 2], [0, 0, -1]);
  ok(hit && S.bodyNames[hit.body] === 'box', 'mj_ray picks the box');
  near(hit.point[2], 0.2, 0.01, 'hit point on the top face');
  ok(lab.pick([1.5, 1.5, 2], [0, 0, -1]) === null, 'the floor (world body) is not picked');
  // the spring lifts the box
  lab.grab(hit); lab.drag([0.02, 0.01, 0.6]);
  for (let i = 0; i < 1500; i++) S.step();
  ok(S.xpos[5] > 0.3, `perturb lifts the box (z ${S.xpos[5].toFixed(3)})`);
  lab.release();
  ok(lab.grabbed === -1, 'release');
  // camera ray: centre pixel goes along the view direction
  const cam = { azimuth: 90, elevation: -30, distance: 4, lookat: [0, 0, 0.5] };
  const r = cameraRay(cam, 400, 300, 800, 600, 45);
  const end = [0, 1, 2].map(i => r.origin[i] + r.dir[i] * 4);
  ok(end.every((x, i) => Math.abs(x - cam.lookat[i]) < 1e-9), 'centre ray reaches lookat');
}

// ---- share link -------------------------------------------------------------------------
{
  const st = { model: 'humanoid', options: { integrator: 'RK4', gravity: [0, 0, -1.62], timestep: 0.0025 }, speed: 0.5, visual: ['cp', 'cf'], camera: { azimuth: 140, elevation: -15, distance: 4, lookat: [0, 0, 1] } };
  const h = encodeShare(st), d = decodeShare('#' + h);
  ok(d.model === 'humanoid' && d.options.integrator === 'RK4' && d.options.gravity[2] === -1.62 && d.options.timestep === 0.0025, 'share: model and options round trip');
  ok(d.speed === 0.5 && d.visual.join() === 'cp,cf' && d.camera.azimuth === 140 && d.camera.lookat[2] === 1, 'share: speed, visual, camera');
  const g = decodeShare(encodeShare({ kind: 'dominoes', seed: 77, options: {} }));
  ok(g.kind === 'dominoes' && g.seed === 77 && !g.model, 'share: generated scene + seed');
  const bad = decodeShare('m=nope&o.dt=-1&o.in=Verlet&o.g=1,2&g=bogus&sp=99&c=1,2');
  ok(!bad.model && !bad.kind && !Object.keys(bad.options).length && bad.speed == null && !bad.camera, 'share: bad values dropped');
  ok(checkOption('iterations', '12.4') === 12 && checkOption('cone', 'elliptic') === 'elliptic' && checkOption('timestep', 1) === undefined, 'checkOption');
  // load from a decoded link applies the options
  await lab.load({ model: d.model });
  lab.setOptions(d.options);
  ok(lab.sim.options().integrator === 'RK4' && Math.abs(lab.sim.options().gravity[2] + 1.62) < 1e-12, 'decoded options apply to the sim');
  const back = decodeShare(encodeShare(lab.shareState()));
  ok(back.model === 'humanoid' && back.options.integrator === 'RK4', 'lab.shareState round trip');
}

// ---- every library model loads through the lab -------------------------------------------
{
  const { MODELS } = await import('./core/models.js');
  let n = 0;
  for (const m of MODELS) { try { const S = await lab.load({ model: m.key }); S.step(20); if ([...S.qpos].every(Number.isFinite)) n++; } catch (e) { console.log(m.key, e.message); } }
  ok(n === MODELS.length, `all ${MODELS.length} library models load through lab.load (${n})`);
}

// ---- io -----------------------------------------------------------------------------------
{
  const h = highlightXML('<!-- c --><mujoco model="a & b"><geom size=".1"/></mujoco>');
  ok(h.includes('<span class="xc">&lt;!-- c --&gt;</span>') && h.includes('<span class="xa">model</span>') && h.includes('<span class="xv">"a &amp; b"</span>'), 'highlight: comment, attribute, value');
  const text = '<mujoco><worldbody/></mujoco>\n<x a="1"/> 5 > 3 "q"';
  ok(highlightXML(text).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') === text + '\n', 'highlight keeps the text');
  const texts = { 'm/robot.xml': '<mujoco model="r"/>', 'm/scene.xml': '<mujoco><include file="robot.xml"/></mujoco>', 'other.xml': '<foo/>' };
  ok(pickMain(texts) === 'm/scene.xml', 'pickMain takes the top file');
  ok(pickMain({ 'a/x.xml': '<mujoco/>', 'a/b/y.xml': '<mujoco><include file="../x.xml"/></mujoco>' }) === 'a/b/y.xml', 'pickMain resolves ../ includes');
  const f = rebase({ 'm/scene.xml': 1, 'm/assets/a.stl': 2, 'm/robot.xml': 3 }, 'm/scene.xml');
  ok(f['assets/a.stl'] === 2 && f['robot.xml'] === 3 && !('scene.xml' in f), 'rebase paths to the top folder');
  ok(modelName('<mujoco model="hello">') === 'hello', 'modelName');
  // an uploaded set: scene + include + mesh compiles in the lab
  const S = await lab.load({ xml: '<mujoco><include file="robot.xml"/></mujoco>', files: { 'robot.xml': '<mujoco model="r"><worldbody><body><freejoint/><geom size=".1"/></body></worldbody></mujoco>' } });
  ok(S.nbody === 2, 'include file from the upload set compiles');
}

// ---- leaks: 30 loads keep the heap flat after warm-up -----------------------------------------
{
  const { heapBytes } = await import('./core/engine.js');
  for (let i = 0; i < 5; i++) await lab.load({ kind: 'mixed', seed: i + 1 });
  const h0 = heapBytes();
  for (let i = 0; i < 30; i++) { await lab.load({ kind: 'mixed', seed: (i % 5) + 1 }); lab.pick([0, 0, 3], [0, 0, -1]); lab.contactInfo(); }
  ok(heapBytes() === h0, `heap flat over 30 loads (${(h0 / 2 ** 20).toFixed(1)} MiB -> ${(heapBytes() / 2 ** 20).toFixed(1)} MiB)`);
  lab.dispose();
  ok(lab.sim === null, 'dispose');
}

// ---- main.js links (no SyntaxError, no missing export) ----------------------------------------
if ((await import('node:fs')).existsSync(new URL('./main.js', import.meta.url))) {
  let err = null;
  try { await import('./main.js'); } catch (e) { err = e; }
  ok(err && !(err instanceof SyntaxError) && /document|window|location|matchMedia|addEventListener/.test(String(err.message)), 'main.js links; stops only at a browser global: ' + (err && err.message));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
