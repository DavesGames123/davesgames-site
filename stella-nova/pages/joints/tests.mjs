// ============================================================================
//  JOINT SIMULATION TESTS  ·  node stella-nova/pages/joints/tests.mjs
// ----------------------------------------------------------------------------
//  upstream      the three upstream scene files load through the upstream
//                importer with their body and joint counts, and run 300
//                steps finite
//  made scenes   every made scene (scenes.js makeScene) loads through the
//                upstream importer: each joint finds its two bodies, each
//                body has a Visual mesh
//  hinge         a hinge chain keeps every joint within 1 mm of its anchor
//                (the joint holds) over 300 steps
//  motor         the windmill rotor turns under the motor joint drive
//  prismatic     the carts stay on their rails within the limits
//  random scenes N seeds of the randomizer (scenes.js with its guard) run
//                300 steps each: no NaN, bodies above the floor or near
//                it. N = 30 (JT_FULL=1: 120).
//  determinism   one seed, one scene, one result
//  hash          every control round-trips through the share link
//  saver         the saver plan: no back-to-back repeats, 6-12 s cuts
//  page          main.js boots under the DOM stub (no WebGL), loads a
//                scene, autoplays, and the saver cuts with TeX
// ============================================================================
import vm from 'node:vm';
import fs from 'node:fs';
import { installDom } from '../../widgets/sim-kit/test/stubs.mjs';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
installDom({ w: 1280, h: 800 });
vm.runInThisContext(fs.readFileSync(new URL('../../vendor/three@0.139.2/build/three.min.js', import.meta.url), 'utf8'));
// the page fetches the scene files: serve them from disk
globalThis.fetch = async u => { const p = new URL(String(u)); const b = fs.readFileSync(p); return { ok: true, status: 200, json: async () => JSON.parse(b.toString()) }; };
const E = await import('./engine.js');
const SC = await import('./scenes.js');
const { SHOTS } = await import('./saver.js');
const K = await import('../../widgets/sim-kit/core.js');
const SCHEMA = SC.makeSchema(false);
const C = { pal: k => [[1, 0.3, 0.3], [0.3, 1, 0.5], [0.3, 0.5, 1]][k % 3], wall: [0.8, 0.8, 0.8], accent: [1, 0.8, 0.2] };
const fake = { add() {}, remove() {} };
const load = (data, g = 9.81) => { const sim = new E.RigidBodySimulator(fake, new THREE.Vector3(0, -g, 0)); new E.SceneImporter(sim, fake).loadScene(data); return sim; };
const fileData = id => JSON.parse(fs.readFileSync(new URL(SC.FILES[id], import.meta.url)));
const finite = sim => sim.rigidBodies.every(b => Number.isFinite(b.pos.x + b.pos.y + b.pos.z + b.rot.w) && b.pos.y > -0.5 && Math.hypot(b.pos.x, b.pos.z) < 5);
const sceneOf = (seed, over = {}) => Object.assign(K.randomize(SCHEMA, seed, K.defaults(SCHEMA), { guard: SC.guard }).state, over);
const dataOf = (st, seed) => SC.isFile(st.scene) ? fileData(st.scene) : SC.makeScene(SC.sceneConfig(st), SC.sceneRng(seed), C);

{
  const counts = {}; let fin = true;
  for (const id of Object.keys(SC.FILES)) { const sim = load(fileData(id)); for (let i = 0; i < 300; i++) sim.simulate(); counts[id] = sim.rigidBodies.length + '/' + sim.joints.length; fin = fin && finite(sim); }
  ok(fin && counts.basic === '16/8' && counts.steering === '7/11' && counts.pendulum === '11/8', 'upstream: the three scene files load (bodies/joints) and run 300 steps finite', JSON.stringify(counts));
}
{
  const bad = [];
  for (const id of ['hinges', 'rope', 'arm', 'windmill', 'cartpole']) {
    const st = SC.guard(Object.assign(K.defaults(SCHEMA), { scene: id })), data = SC.makeScene(SC.sceneConfig(st), SC.sceneRng(1), C);
    const names = new Set(data.meshes.filter(m => /^Rigid/.test(m.properties.simType)).map(m => m.name));
    const joints = data.meshes.filter(m => /Joint$/.test(m.properties.simType)), vis = new Set(data.meshes.filter(m => m.properties.simType === 'Visual').map(m => m.properties.parent));
    const sim = load(data);
    if (!joints.every(j => names.has(j.properties.parent1) && names.has(j.properties.parent2)) || sim.joints.length !== joints.length || ![...names].every(n => vis.has(n))) bad.push(id);
  }
  ok(!bad.length, 'made scenes: every joint finds its bodies, every body has a Visual mesh', bad.join(' '));
}
{
  const st = SC.guard(Object.assign(K.defaults(SCHEMA), { scene: 'hinges', count: 4, damping: 0 })), sim = load(SC.makeScene(SC.sceneConfig(st), SC.sceneRng(2), C));
  let gap = 0;
  for (let i = 0; i < 300; i++) { sim.simulate(); for (const j of sim.joints) { j.updateGlobalFrames(); gap = Math.max(gap, j.globalPos0.distanceTo(j.globalPos1)); } }
  ok(gap < 0.001 && finite(sim), 'hinge: every hinge of a chain holds within 1 mm', `${(gap * 1000).toFixed(3)} mm`);
}
{
  const st = SC.guard(Object.assign(K.defaults(SCHEMA), { scene: 'windmill' })), sim = load(SC.makeScene(SC.sceneConfig(st), SC.sceneRng(3), C));
  const rotor = sim.rigidBodies.find(b => b.invMass > 0 && b.size.z === 0.05), q0 = rotor.rot.clone();
  let turned = 0; for (let i = 0; i < 60; i++) { sim.controlVector.set(0, 0.8); sim.simulate(); turned = Math.max(turned, 2 * Math.acos(Math.min(1, Math.abs(q0.dot(rotor.rot))))); }
  ok(turned > 1, 'motor: the windmill rotor turns under the motor drive', `${turned.toFixed(2)} rad in 2 s`);
}
{
  const st = SC.guard(Object.assign(K.defaults(SCHEMA), { scene: 'cartpole', count: 8 })), sim = load(SC.makeScene(SC.sceneConfig(st), SC.sceneRng(4), C));
  const carts = sim.rigidBodies.filter(b => b.invMass > 0 && b.size.x > 0.12 && b.size.y < 0.07);
  let off = 0;
  for (let i = 0; i < 300; i++) { carts.forEach((b, k) => { b.vel.x = 0.6 * Math.cos(i * 0.1 + k); }); sim.simulate(); for (const b of carts) off = Math.max(off, Math.abs(b.pos.y - 0.5), Math.abs(b.pos.x) - 0.5); }
  ok(carts.length > 0 && off < 0.01, 'prismatic: the driven carts stay on their rails and in their limits', `${carts.length} carts, worst ${off.toFixed(4)} m`);
}
{
  const N = process.env.JT_FULL ? 120 : 30, bad = [];
  for (let s = 1; s <= N; s++) { const st = sceneOf(s), sim = load(dataOf(st, s), st.g); sim.numSubSteps = st.substeps; for (let i = 0; i < 300; i++) sim.simulate(); if (!finite(sim)) bad.push(s + ':' + st.scene); }
  ok(!bad.length, `random scenes: ${N} seeds x 300 steps stay finite and near`, bad.slice(0, 6).join(' '));
}
{
  const st = sceneOf(77, { scene: 'rope' }), a = load(dataOf(st, 77)), b = load(dataOf(st, 77));
  for (let i = 0; i < 200; i++) { a.simulate(); b.simulate(); }
  ok(a.rigidBodies.every((x, i) => x.pos.x === b.rigidBodies[i].pos.x && x.rot.w === b.rigidBodies[i].rot.w), 'determinism: one seed gives one result');
}
{
  let bad = [];
  for (let s = 1; s <= 30; s++) { const st = sceneOf(s), d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, s)); for (const k of Object.keys(st)) if (JSON.stringify(d.state[k]) !== JSON.stringify(st[k])) bad.push(k); }
  ok(!bad.length, 'hash: every control round-trips through the share link', bad.slice(0, 5).join(' '));
}
{
  const plan = K.planShots(SHOTS, 5, 200);
  ok(SHOTS.length >= 6 && plan.every((p, i) => !i || p.key !== plan[i - 1].key) && plan.every(p => p.sec >= 6 && p.sec <= 12) && SHOTS.every(s => s.tex && !s.code), `saver plan: ${SHOTS.length} shots, no repeats, 6-12 s cuts, TeX and no code`);
}
{
  globalThis.TMP = { page() {}, creditLines: () => ['Joint Simulation by Matthias Müller'] };
  await import('./main.js');
  const P = window.__jt;
  await new Promise(r => setTimeout(r, 30));
  runRaf(40);
  ok(P.kit.playing && P.sim && P.sim.rigidBodies.length > 0 && !P.stage.gl, 'page: boots without WebGL, loads a random scene and autoplays', `${P.kit.state.scene}, ${P.sim.rigidBodies.length} bodies`);
  const labels = [];
  await window.snSaver.enter({ seed: 9, label: L => labels.push(L) });
  for (let k = 0; k < 10; k++) { window.snSaver.cut(); await new Promise(r => setTimeout(r, 5)); runRaf(20); }
  const hist = window.snSaver.debug().hist; let rep = 0; for (let i = 1; i < hist.length; i++) if (hist[i].shot === hist[i - 1].shot) rep++;
  const cam = P.stage.camera.position;
  ok(hist.length === 11 && rep === 0 && finite(P.sim) && Number.isFinite(cam.x + cam.y + cam.z) && labels.every(L => L.tex && !L.code), 'page saver: 11 cuts, no repeats, finite sim and camera, TeX plates, no code', hist.map(x => x.shot).join(' '));
  window.snSaver.exit();
  ok(!document.documentElement.classList.contains('sk-saver') && !P.stage.cam.auto, 'page saver: exit restores the page');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
