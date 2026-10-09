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

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
