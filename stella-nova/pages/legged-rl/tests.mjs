// ============================================================================
//  LEGGED ROBOT GYM  ·  tests.mjs — node checks, no browser
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/legged-rl/tests.mjs
//  Loads the vendored MuJoCo WASM in node and the converted policies.
//
//  GREP MAP
//    section('policy ....... JS LSTM vs torch outputs on fixed inputs
//    section('observation .. obs layout, scales and first actions vs Python
//    section('walk ......... commanded speed held for 20 s, no fall
//    section('rewards ...... reward terms finite, scales from the configs
// ============================================================================
import { readFile } from 'node:fs/promises';
import load from '../../vendor/mujoco@3.15.0/mujoco.js';
import { loadRobot, ROBOTS, ORDER, unpack } from './robot.js';
import { createPolicy } from './policy.js';

const here = new URL('./', import.meta.url);
const get = async (p, kind) => { const b = await readFile(new URL(p, here)); return kind === 'text' ? b.toString() : kind === 'json' ? JSON.parse(b) : b; };
const V = '../../vendor/unitree_rl_gym/';
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log('  FAIL', msg); } };
const section = n => console.log(`\n── ${n}`);
const mj = await load();
const POLICY = ORDER.filter(k => ROBOTS[k].policy);

section('policy: JS LSTM + MLP vs torch outputs (40 fixed inputs each)');
for (const key of POLICY) {
  const P = await get(`${V}derived/${key}/policy.json`, 'json'), ref = await get(`${V}derived/${key}/reference.json`, 'json');
  const p = createPolicy(P); let e = 0;
  ref.inputs.forEach((x, i) => { const y = p.step(Float32Array.from(x)); ref.outputs[i].forEach((v, k) => { e = Math.max(e, Math.abs(v - y[k])); }); });
  console.log(`  ${key.padEnd(5)} max |js - torch| = ${e.toExponential(2)} over ${ref.inputs.length} x ${P.nact}`);
  ok(e < 1e-4, `${key} policy error ${e}`);
}

section('observation: layout and scales vs deploy_mujoco.py, first 3 control steps');
for (const key of POLICY) {
  const S = await loadRobot(mj, key, get), ref = await get(`${V}derived/${key}/reference.json`, 'json');
  const yaml = await get(`${V}deploy/deploy_mujoco/configs/${key}.yaml`, 'text');
  // the config numbers come from the upstream YAML, unchanged
  const num = k => JSON.parse(yaml.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))[1].replace(/\s+#.*$/, ''));
  for (const k of ['simulation_dt', 'control_decimation', 'ang_vel_scale', 'dof_pos_scale', 'dof_vel_scale', 'action_scale', 'num_actions', 'num_obs'])
    ok(num(k) === S.cfg[k], `${key} ${k} ${num(k)} != ${S.cfg[k]}`);
  const kps = JSON.parse(yaml.match(/^kps:\s*(\[[^\]]*\])/m)[1]), dflt = JSON.parse(yaml.match(/^default_angles:\s*(\[[^\]]*\])/m)[1].replace(/\s+/g, ''));
  ok(JSON.stringify(kps) === JSON.stringify(S.cfg.kps), `${key} kps`);
  ok(JSON.stringify(dflt) === JSON.stringify(S.cfg.default_angles), `${key} default angles`);
  ok(S.NO === 9 + 3 * S.NA + 2, `${key} obs length ${S.NO} = 9 + 3 * ${S.NA} + 2`);
  let eo = 0, ea = 0, k = 0;
  for (let i = 0; i < 3 * S.cfg.control_decimation; i++) if (S.step()) {
    const r = ref.rollout_hull.first[k++];
    r.obs.forEach((v, j) => { eo = Math.max(eo, Math.abs(v - S.obs[j])); });
    r.action.forEach((v, j) => { ea = Math.max(ea, Math.abs(v - S.action[j])); });
  }
  console.log(`  ${key.padEnd(5)} obs ${S.NO} = [w*${S.cfg.ang_vel_scale} (3), g (3), cmd*[${S.cfg.cmd_scale}] (3), q-q0 (${S.NA}), dq*${S.cfg.dof_vel_scale} (${S.NA}), a (${S.NA}), sin, cos]  max obs err ${eo.toExponential(2)}  action err ${ea.toExponential(2)}`);
  ok(eo < 1e-4 && ea < 1e-4, `${key} obs/action vs python: ${eo} ${ea}`);
  S.dispose();
}

section('walk: 20 s at the commanded speed, no fall (policy robots); Go2 scripted trot');
for (const key of ORDER) {
  const S = await loadRobot(mj, key, get);
  let fell = false, vx = 0, n = 0;
  const steps = Math.round(20 / S.cfg.simulation_dt);
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) if (S.step()) { if (S.fallen) fell = true; if (S.t > 5) { vx += S.bodyVel()[0]; n++; } }
  vx /= n;
  const ms = performance.now() - t0;
  console.log(`  ${key.padEnd(5)} cmd vx ${S.cmd[0]}  mean body vx (5-20 s) ${vx.toFixed(3)} m/s  x ${S.d.qpos[0].toFixed(2)} m  z ${S.d.qpos[2].toFixed(3)}  fallen ${fell}  (${(ms).toFixed(0)} ms for 20 s)`);
  ok(!fell, `${key} fell`);
  if (ROBOTS[key].policy) {
    ok(Math.abs(vx - S.cmd[0]) < 0.1, `${key} speed ${vx} vs ${S.cmd[0]}`);
    // the JS run is the same as the Python run of convert.py (same MuJoCo)
    const ref = await get(`${V}derived/${key}/reference.json`, 'json');
    S.reset(); for (let i = 0; i < Math.round(10 / S.cfg.simulation_dt); i++) S.step();
    const p = ref.rollout_hull.path.at(-1), gap = Math.hypot(p[1] - S.d.qpos[0], p[2] - S.d.qpos[1]);
    console.log(`        10 s base vs Python MuJoCo: gap ${gap.toExponential(2)} m`);
    ok(gap < 1e-3, `${key} path gap ${gap}`);
  } else ok(vx > 0.15, `go2 trot moves forward ${vx}`);
  S.dispose();
}

section('rewards: terms finite, scales from legged_gym configs');
for (const key of ORDER) {
  const S = await loadRobot(mj, key, get);
  let bad = 0, sum = 0;
  for (let i = 0; i < Math.round(4 / S.cfg.simulation_dt); i++) if (S.step()) for (const k in S.rew) { if (!Number.isFinite(S.rew[k].value)) bad++; }
  for (const k in S.rew) sum += S.rew[k].value;
  console.log(`  ${key.padEnd(5)} ${Object.keys(S.rew).length} terms: ${Object.entries(S.rew).map(([k, r]) => `${k} ${r.scale}`).join(', ')}`);
  ok(bad === 0, `${key} non-finite reward terms ${bad}`);
  ok(Number.isFinite(S.rewTotal) && S.rewTotal > 0, `${key} total ${S.rewTotal}`);
  S.dispose();
}
ok(ROBOTS.g1.rewards.tracking_lin_vel === 1 && ROBOTS.g1.rewards.feet_swing_height === -20 && ROBOTS.g1.rewards.alive === 0.15, 'g1 scales as g1_config.py');
ok(!('feet_air_time' in ROBOTS.g1.rewards) && !('collision' in ROBOTS.g1.rewards), 'g1 zero scales dropped');
ok(ROBOTS.go2.rewards.torques === -0.0002 && ROBOTS.go2.rewards.dof_pos_limits === -10 && !('base_height' in ROBOTS.go2.rewards) && ROBOTS.go2.rewards.feet_air_time === 1, 'go2 scales as go2_config.py over the base config');
ok(ROBOTS.h1.rewards.collision === -1 && !('torques' in ROBOTS.h1.rewards) && !('dof_vel' in ROBOTS.h1.rewards), 'h1 scales as h1_config.py');

section('meshes: visual packs name every upstream mesh file');
for (const key of ORDER) {
  const S = await loadRobot(mj, key, get), Vb = unpack(await get(`${V}derived/${key}/visual.bin`, 'buf'));
  const miss = Object.values(S.meshFiles).filter(f => !Vb[f]);
  console.log(`  ${key.padEnd(5)} ${Object.keys(Vb).length} visual meshes, ${S.m.nmesh} model meshes, missing ${miss.length}`);
  ok(miss.length === 0, `${key} missing ${miss}`);
  S.dispose();
}

section('saver: shot plan rules (seeds 1-200, desktop and phone)');
{
  const { makePlan, KINDS, PARADE } = await import('./saver-plan.js');
  let rep = 0, badDur = 0, go2sees = 0, phoneSquad = 0, order = 0, kindsSeen = new Set(), longest = 0;
  for (let seed = 1; seed <= 200; seed++) for (const phone of [false, true]) {
    const P = makePlan(seed, 60, { phone });
    let run = 1;
    P.forEach((s, i) => {
      kindsSeen.add(s.kind);
      if (s.dur < 6 || s.dur > 12) badDur++;
      if (i && P[i - 1].kind === s.kind) rep++;
      if (s.lead === 'go2' && !KINDS[s.kind].go2) go2sees++;
      if (phone && s.kind === 'squad') phoneSquad++;
      if (i) { const a = PARADE.indexOf(P[i - 1].lead), b = PARADE.indexOf(s.lead); if (b === a) run++; else { if (b !== (a + 1) % 4) order++; longest = Math.max(longest, run); run = 1; } }
    });
  }
  console.log(`  2 x 200 plans of 60 shots: back-to-back repeats ${rep}, durations outside 6-12 s ${badDur}, Go2 in a policy-only kind ${go2sees}, squad on phone ${phoneSquad}, parade order breaks ${order}, kinds used ${kindsSeen.size}/${Object.keys(KINDS).length}, longest run on one robot ${longest}`);
  ok(rep === 0 && badDur === 0 && go2sees === 0 && phoneSquad === 0 && order === 0 && kindsSeen.size === Object.keys(KINDS).length && longest <= 3, 'plan rules');
}

section('saver: every shot run headless (cameras finite, never inside a robot, no falls)');
{
  const { makePlan, cmdAt, camAt, pushVec, DIM, SQUAD, PARADE, yawOf } = await import('./saver-plan.js');
  const sims = {};
  const sim = async k => (sims[k] = sims[k] || await loadRobot(mj, k, get));
  let shots = 0, frames = 0, nonFinite = 0, inside = 0, falls = 0, minGap = Infinity;
  const t0 = performance.now();
  for (const [seed, phone, count] of [[7, false, 18], [2026, false, 18], [5, true, 14]]) {
    for (const shot of makePlan(seed, count, { phone })) {
      const keys = shot.robot === 'all' ? PARADE : [shot.robot];
      const R = [];
      for (const k of keys) { const S = await sim(k); S.cmdKeep = null; S.reset(); R.push({ S, off: shot.robot === 'all' ? [0, SQUAD[k]] : [0, 0], acc: 0 }); }
      const L = R.find(r => r.S.key === shot.lead) || R[0];
      let t = 0, pushed = false, fell = false;
      const dt = 1 / 30;
      while (t < shot.dur) {
        t += dt;
        for (const r of R) {
          r.acc += dt * shot.slow;
          while (r.acc >= r.S.cfg.simulation_dt) { r.acc -= r.S.cfg.simulation_dt; const c = cmdAt(shot.cmd, t); r.S.cmd.set(c); if (r.S.step() && r.S.fallen) fell = true; }
        }
        if (shot.kind === 'push' && !pushed && t >= shot.pushAt) { const v = pushVec(shot, yawOf(L.S.base().q)); L.S.push(v[0], v[1]); pushed = true; }
        const b = L.S.base();
        let bx = b.x, by = b.y;
        if (shot.robot === 'all') { bx = 0; by = 0; for (const r of R) { const q = r.S.base(); bx += q.x + r.off[0]; by += q.y + r.off[1]; } bx /= R.length; by /= R.length; }
        const f = L.S.footPos[0];
        const c = camAt(shot, t, { x: bx, y: by, z: b.z, yaw: yawOf(b.q) }, DIM[shot.robot === 'all' ? 'h1' : shot.robot], [f[0], f[1], f[2]]);
        if (![...c.pos, ...c.target, c.fov].every(Number.isFinite)) nonFinite++;
        for (const r of R) {
          const q = r.S.base(), D = DIM[r.S.key], hx = c.pos[0] - q.x - r.off[0], hy = c.pos[1] - q.y - r.off[1];
          if (Math.hypot(hx, hy) < D.r && c.pos[2] < D.h + 0.05) inside++;
          const X = r.S.d.xpos;
          for (let i = 1; i < r.S.m.nbody; i++) minGap = Math.min(minGap, Math.hypot(c.pos[0] - X[3 * i] - r.off[0], c.pos[1] - X[3 * i + 1] - r.off[1], c.pos[2] - X[3 * i + 2]));
        }
        frames++;
      }
      if (fell) { falls++; console.log(`  fell: seed ${seed} shot ${shot.i} ${shot.kind} ${shot.lead} ${shot.cmd}`); }
      shots++;
    }
  }
  console.log(`  ${shots} shots, ${frames} camera frames at 30 Hz: non-finite ${nonFinite}, camera inside a robot ${inside}, nearest body ${minGap.toFixed(2)} m, falls ${falls}  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  ok(nonFinite === 0 && inside === 0 && minGap > 0.25 && falls === 0, 'saver shots');
  for (const k in sims) sims[k].dispose();
}

section('page boot: main.js in node with DOM stand-ins and a stand-in renderer');
{
  const { boot } = await import('./stub-boot.mjs');
  const r = await boot({ frames: 300 });
  globalThis.__lrlBoot = r;
  const G = r.G;
  console.log(`  robot ${G.key}  sim t ${G.S.t.toFixed(2)} s after 300 frames  meshes ${G.rv.meshes.length}  renders ${G.view.renderer.renders}  errors ${r.errors.length}`);
  ok(r.errors.length === 0, 'boot errors: ' + r.errors.slice(0, 3).join(' | '));
  ok(G.key === 'g1' && Math.abs(G.S.t - 5) < 0.1, `5 s of sim in 300 frames: ${G.S.t}`);
  ok(/G1/.test(r.get('read').innerHTML) && r.get('rewTable').innerHTML.includes('tracking lin vel'), 'readout and reward table filled');
  for (const k of ['go2', 'h1_2']) { await G.setRobot(k); await r.step(60); ok(G.key === k && G.view.robots.length === 1 && G.S.t > 0.9, `swap to ${k}: one robot in the view`); }
  r.win.__lrl.S.push(0, 0.8); await r.step(30);
  ok(r.errors.length === 0, 'no errors after swaps and a push');
  console.log(`  swaps g1 -> go2 -> h1_2: robots in view ${G.view.robots.length}, errors ${r.errors.length}`);
}

section('saver in the booted page: enter(), cuts, plate labels, memory between shots');
{
  const r = globalThis.__lrlBoot, G = r.G, labels = [], robotsPerCut = [];
  let maxRobots = 0;
  const ret = r.win.snSaver.enter({ seed: 11, calm: 0.5, label: l => labels.push(l) });
  ok(ret && ret.canvas && ret.warmupMs > 0, 'enter returns { canvas, warmupMs }');
  ok(G.S === null, 'the play robot is freed when the saver starts');
  for (let i = 0; i < 160; i++) {
    await new Promise(res => setTimeout(res, 25));
    await r.step(15);
    maxRobots = Math.max(maxRobots, G.view.robots.length);
    if (labels.length && robotsPerCut.at(-1) !== labels.length) robotsPerCut.push(labels.length);
  }
  const titles = [...new Set(labels.map(l => l.title))];
  const subs = [...new Set(labels.map(l => l.sub.split(' · ')[0]))];
  const texOk = labels.every(l => Array.isArray(l.tex) && l.tex.length && l.params.length && !('code' in l));
  console.log(`  ${labels.length} plate updates, robots ${titles.join(', ')}, shot kinds ${subs.join(', ')}, most robots in view at once ${maxRobots}, errors ${r.errors.length}`);
  ok(subs.length >= 3 && titles.length >= 1 && texOk, 'plate: several shots, TeX and params, no code');
  ok(maxRobots <= 4 && r.errors.length === 0, 'saver ran with no errors and at most 4 robots');
  G.saver.dispose();
  ok(G.view.robots.length === 0, 'dispose frees every saver robot');
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
