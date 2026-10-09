// ============================================================================
//  LEGGED ROBOT GYM  ·  robot.js — MuJoCo model, deploy loop, rewards
// ----------------------------------------------------------------------------
//  The sim2sim step of unitree_rl_gym (deploy/deploy_mujoco/deploy_mujoco.py)
//  in JS, on the official MuJoCo WASM build. No DOM, no THREE: tests.mjs
//  runs it in node.
//
//  DEPLOY LOOP (one physics step; the same order as upstream)
//    tau = kp (q* - q) + kd (0 - dq)          PD on the joint targets
//    ctrl = tau, mj_step, counter += 1
//    every control_decimation steps (50 Hz):
//      obs = [ omega*0.25, g_b, cmd*cmd_scale, (q - q0), dq*0.05, a_prev,
//              sin 2 pi phi, cos 2 pi phi ],  phi = t mod 0.8 / 0.8
//      a = policy(obs);  q* = a * action_scale + q0
//
//  REWARDS
//    The terms and scales of legged_gym/envs/<robot>/<robot>_config.py and
//    <robot>_env.py, computed each control step as a readout. Training
//    multiplies each scale by dt (0.02 s); RTERMS keeps the raw scale.
//
//  GO2
//    unitree_rl_gym ships no Go2 policy. The Go2 runs an open-loop scripted
//    trot (sine targets on the PD joints), named so on the page.
//
//  GREP MAP
//    export const ROBOTS ......... per robot: files, feet, reward scales
//    export function unpack ...... collide.bin / visual.bin reader
//    export function meshFile .... STL / OBJ bytes for the MuJoCo VFS
//    export async function loadRobot  fetch + compile -> Sim
//    function makeObs ............ the 47 / 41 observation vector
//    function rewardStep ......... the reward terms
//    function go2Targets ......... the scripted trot
// ============================================================================
import { createPolicy } from './policy.js';

const V = '../../vendor/unitree_rl_gym/';
const BASE_SCALES = { torques: -1e-5, dof_acc: -2.5e-7, action_rate: -0.01, lin_vel_z: -2.0, ang_vel_xy: -0.05, collision: -1.0, feet_air_time: 1.0, tracking_lin_vel: 1.0, tracking_ang_vel: 0.5 };
const HUMANOID = {
  tracking_lin_vel: 1.0, tracking_ang_vel: 0.5, lin_vel_z: -2.0, ang_vel_xy: -0.05, orientation: -1.0,
  base_height: -10.0, dof_acc: -2.5e-7, dof_vel: -1e-3, feet_air_time: 0.0, collision: 0.0, action_rate: -0.01,
  dof_pos_limits: -5.0, alive: 0.15, hip_pos: -1.0, contact_no_vel: -0.2, feet_swing_height: -20.0, contact: 0.18,
};
// the scales a config sets, over the base LeggedRobotCfg.rewards.scales
const scales = over => { const s = { ...BASE_SCALES, ...over }; for (const k in s) if (!s[k]) delete s[k]; return s; };

export const ROBOTS = {
  g1: {
    name: 'G1', kind: 'Humanoid · 12 leg joints', policy: true,
    dir: 'resources/robots/g1_description/', scene: 'scene.xml', xml: 'g1_12dof.xml', meshPrefix: 'meshes/',
    feet: ['left_ankle_roll_link', 'right_ankle_roll_link'], hipRe: /_hip_(roll|yaw)_joint$/,
    heightTarget: 0.78, rewards: scales(HUMANOID), train: { dt: 0.005, decimation: 4 }, penalize: /hip|knee/,
    dr: { friction: [0.1, 1.25], mass: [-1, 3], push: 1.5, pushEvery: 5 },
  },
  h1: {
    name: 'H1', kind: 'Humanoid · 10 leg joints', policy: true,
    dir: 'resources/robots/h1/', scene: 'scene.xml', xml: 'h1.xml', meshPrefix: 'meshes/',
    feet: ['left_ankle_link', 'right_ankle_link'], hipRe: /_hip_(roll|yaw)_joint$/,
    heightTarget: 1.05, rewards: scales({ ...HUMANOID, dof_vel: 0, collision: -1.0, torques: 0.0 }), train: { dt: 0.005, decimation: 4 }, penalize: /hip|knee/,
    dr: { friction: [0.1, 1.25], mass: [-1, 3], push: 1.5, pushEvery: 5 },
  },
  h1_2: {
    name: 'H1-2', kind: 'Humanoid · 12 leg joints', policy: true,
    dir: 'resources/robots/h1_2/', scene: 'scene.xml', xml: 'h1_2_12dof.xml', meshPrefix: 'meshes/',
    feet: ['left_ankle_roll_link', 'right_ankle_roll_link'], hipRe: /_hip_(roll|yaw)_joint$/,
    heightTarget: 1.0, rewards: scales(HUMANOID), train: { dt: 0.0025, decimation: 8 }, penalize: /hip|knee/,
    dr: { friction: [0.1, 1.25], mass: [-1, 3], push: 1.5, pushEvery: 5 },
  },
  go2: {
    name: 'Go2', kind: 'Quadruped · scripted trot, no policy', policy: false,
    dir: 'unitree_mujoco/go2/', xml: 'go2.xml', meshPrefix: 'assets/',
    feet: ['FL_calf', 'FR_calf', 'RL_calf', 'RR_calf'], footOff: [0, 0, -0.213], hipRe: /_hip_joint$/,
    heightTarget: 0.25, rewards: scales({ torques: -0.0002, dof_pos_limits: -10.0 }),
    train: { dt: 0.005, decimation: 4 }, penalize: /thigh/,
    dr: { friction: [0.5, 1.25], mass: [-1, 1], push: 1.0, pushEvery: 15 },
    // default angles from legged_gym/envs/go2/go2_config.py. Its kp 20,
    // kd 0.5 suit a trained policy; the open-loop trot sags at kp 20, so
    // the scripted gait uses kp 40, kd 1 (our choice, not upstream).
    cfg: {
      simulation_dt: 0.002, control_decimation: 10, kps: 40, kds: 1, action_scale: 0.25,
      default: { FL_hip_joint: 0.1, RL_hip_joint: 0.1, FR_hip_joint: -0.1, RR_hip_joint: -0.1, FL_thigh_joint: 0.8, RL_thigh_joint: 1.0, FR_thigh_joint: 0.8, RR_thigh_joint: 1.0, FL_calf_joint: -1.5, RL_calf_joint: -1.5, FR_calf_joint: -1.5, RR_calf_joint: -1.5 },
    },
  },
};
export const ORDER = ['g1', 'h1', 'h1_2', 'go2'];
// scripted trot gains (Go2 only): stride per m/s, per rad/s, lateral, lift
export const G2 = { kx: 1.6, kw: 0.5, ky: 1.2, lift: 2.4 };
export const PERIOD = 0.8, SIGMA = 0.25, SWING_Z = 0.08, STANCE = 0.55;

// ── pack files ──────────────────────────────────────────────────────────────
// [u32 header length][header JSON {files:[{name,offset,length,nv,nt}]}][payload]
// payload per entry: float32 xyz * nv, then uint16 abc * nt
export function unpack(buf) {
  const ab = buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const n = new DataView(ab).getUint32(0, true);
  const H = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 4, n)));
  const base = 4 + n, out = {};
  for (const e of H.files) {
    const o = base + e.offset;
    out[e.name] = { v: new Float32Array(ab, o, e.nv * 3), t: new Uint16Array(ab.slice(o + 12 * e.nv, o + 12 * e.nv + 6 * e.nt)) };
  }
  return out;
}
// the same bytes as to_mesh_file() in tools/legged-rl/convert.py
export function meshFile(name, v, t) {
  if (/\.obj$/i.test(name)) {
    const g = x => +x.toPrecision(9);
    let s = '';
    for (let i = 0; i < v.length; i += 3) s += `v ${g(v[i])} ${g(v[i + 1])} ${g(v[i + 2])}\n`;
    for (let i = 0; i < t.length; i += 3) s += `f ${t[i] + 1} ${t[i + 1] + 1} ${t[i + 2] + 1}\n`;
    return new TextEncoder().encode(s);
  }
  const nt = t.length / 3, ab = new ArrayBuffer(84 + 50 * nt), dv = new DataView(ab);
  dv.setUint32(80, nt, true);
  for (let f = 0; f < nt; f++) {
    let o = 84 + 50 * f + 12;
    for (let k = 0; k < 3; k++) { const i = t[3 * f + k] * 3; dv.setFloat32(o, v[i], true); dv.setFloat32(o + 4, v[i + 1], true); dv.setFloat32(o + 8, v[i + 2], true); o += 12; }
  }
  return new Uint8Array(ab);
}

// mesh name -> file, from the <mesh> tags of the robot MJCF (MuJoCo names a
// mesh with no name after its file, without the extension)
export function meshMap(xml) {
  const out = {};
  for (const tag of xml.match(/<mesh\b[^>]*>/g) || []) {
    const file = (tag.match(/\bfile="([^"]+)"/) || [])[1];
    if (!file) continue;
    const name = (tag.match(/\bname="([^"]+)"/) || [])[1] || file.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
    out[name] = file;
  }
  return out;
}

// ── load ────────────────────────────────────────────────────────────────────
// get(path, 'text' | 'json' | 'buf') -> Promise; paths are relative to V
export async function loadRobot(mj, key, get) {
  const R = ROBOTS[key], D = `derived/${key}/`;
  const [xml, scene, col, pol] = await Promise.all([
    get(V + R.dir + R.xml, 'text'),
    R.scene ? get(V + R.dir + R.scene, 'text') : null,
    get(V + D + 'collide.bin', 'buf'),
    R.policy ? get(V + D + 'policy.json', 'json') : null,
  ]);
  const vfs = new mj.MjVFS(), enc = new TextEncoder();
  let model;
  try {
    vfs.addBuffer(R.xml, enc.encode(xml));
    const C = unpack(col);
    for (const name in C) vfs.addBuffer(name, meshFile(name, C[name].v, C[name].t));
    // Go2: upstream go2.xml under a plain floor (its scene.xml has stairs)
    const top = scene || `<mujoco model="go2 floor"><include file="${R.xml}"/><worldbody><light pos="0 0 3" dir="0 0 -1" directional="true"/><geom name="floor" size="0 0 0.05" type="plane"/></worldbody></mujoco>`;
    model = mj.MjModel.from_xml_string(top, vfs);
  } finally { vfs.delete(); }
  const S = createSim(mj, model, key, pol);
  S.meshFiles = meshMap(xml);
  return S;
}

// ── sim ─────────────────────────────────────────────────────────────────────
function gravityOrientation(q, out) {
  const [qw, qx, qy, qz] = q;
  out[0] = 2 * (-qz * qx + qw * qy);
  out[1] = -2 * (qz * qy + qw * qx);
  out[2] = 1 - 2 * (qw * qw + qz * qz);
  return out;
}
// world vector into the base frame (q = w x y z)
function toBody(q, v, out) {
  const [w, x, y, z] = q, [a, b, c] = v;
  const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - w * z), r02 = 2 * (x * z + w * y);
  const r10 = 2 * (x * y + w * z), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - w * x);
  const r20 = 2 * (x * z - w * y), r21 = 2 * (y * z + w * x), r22 = 1 - 2 * (x * x + y * y);
  out[0] = r00 * a + r10 * b + r20 * c; out[1] = r01 * a + r11 * b + r21 * c; out[2] = r02 * a + r12 * b + r22 * c;
  return out;
}

export function createSim(mj, m, key, P) {
  const R = ROBOTS[key], OBJ = mj.mjtObj, d = new mj.MjData(m);
  const name = (t, i) => mj.mj_id2name(m, OBJ[t].value, i) || '';
  const nj = m.nu, jn = [];
  for (let i = 1; i < m.njnt; i++) jn.push(name('mjOBJ_JOINT', i));
  // actuator a drives leg joint actJ[a] (humanoids: the qpos order; Go2: FR first)
  const actJ = [];
  for (let a = 0; a < m.nu; a++) actJ.push(m.actuator_trnid[2 * a] - 1);
  let cfg;
  if (P) {
    cfg = P.cfg;
  } else {
    const c = R.cfg;
    cfg = {
      simulation_dt: c.simulation_dt, control_decimation: c.control_decimation, kps: jn.map(() => c.kps), kds: jn.map(() => c.kds),
      default_angles: jn.map(j => c.default[j]), action_scale: c.action_scale, num_actions: nj, num_obs: 0,
      ang_vel_scale: 0.25, dof_pos_scale: 1, dof_vel_scale: 0.05, cmd_scale: [2, 2, 0.25], cmd_init: [0.5, 0, 0],
    };
  }
  m.opt.timestep = cfg.simulation_dt;
  const NA = cfg.num_actions, NO = cfg.num_obs;
  const kp = Float64Array.from(cfg.kps), kd = Float64Array.from(cfg.kds), q0 = Float64Array.from(cfg.default_angles);
  const feet = R.feet.map(f => mj.mj_name2id(m, OBJ.mjOBJ_BODY.value, f));
  const hips = jn.map((j, i) => R.hipRe.test(j) ? i : -1).filter(i => i >= 0);
  const pen = []; for (let b = 1; b < m.nbody; b++) if (R.penalize.test(name('mjOBJ_BODY', b))) pen.push(b);
  const lim = jn.map((j, i) => { const a = m.jnt_range[2 * (i + 1)], b = m.jnt_range[2 * (i + 1) + 1], mid = (a + b) / 2, r = (b - a) / 2 * 0.9; return [mid - r, mid + r]; });
  const pelvis = 1, mass0 = m.body_mass[pelvis];
  const fr0 = []; for (let g = 0; g < m.ngeom; g++) fr0.push(m.geom_friction[3 * g]);

  const S = {
    key, R, m, d, cfg, jn, NA, NO, feet, hips,
    cmd: Float64Array.from(cfg.cmd_init), obs: new Float32Array(NO), action: new Float32Array(NA),
    target: Float64Array.from(q0), tau: new Float64Array(NA), counter: 0, t: 0,
    policy: null, rew: {}, rewSum: 0, rewTotal: 0, fallen: false, fallT: 0,
    footPos: R.feet.map(() => [0, 0, 0]), footVel: R.feet.map(() => [0, 0, 0]), contact: R.feet.map(() => false), forceZ: R.feet.map(() => 0),
    phase: 0, friction: 1, payload: 0, pushes: 0, lastPush: null,
  };
  if (P) S.policy = createPolicy(P);
  const airT = R.feet.map(() => 0), lastC = R.feet.map(() => false);
  const g3 = [0, 0, 0], vb = [0, 0, 0], lastDq = new Float64Array(NA), lastA = new Float32Array(NA), prevFoot = R.feet.map(() => [0, 0, 0]);
  const quat = () => [d.qpos[3], d.qpos[4], d.qpos[5], d.qpos[6]];

  function makeObs() {
    const o = S.obs, q = d.qpos, v = d.qvel;
    o[0] = v[3] * cfg.ang_vel_scale; o[1] = v[4] * cfg.ang_vel_scale; o[2] = v[5] * cfg.ang_vel_scale;
    gravityOrientation(quat(), g3); o[3] = g3[0]; o[4] = g3[1]; o[5] = g3[2];
    for (let k = 0; k < 3; k++) o[6 + k] = S.cmd[k] * cfg.cmd_scale[k];
    for (let i = 0; i < NA; i++) {
      o[9 + i] = (q[7 + i] - q0[i]) * cfg.dof_pos_scale;
      o[9 + NA + i] = v[6 + i] * cfg.dof_vel_scale;
      o[9 + 2 * NA + i] = S.action[i];
    }
    const ph = S.counter * cfg.simulation_dt % PERIOD / PERIOD;
    o[9 + 3 * NA] = Math.sin(2 * Math.PI * ph); o[9 + 3 * NA + 1] = Math.cos(2 * Math.PI * ph);
    S.phase = ph;
    return o;
  }

  function sense() {
    mj.mj_rnePostConstraint(m, d);
    const dt = cfg.simulation_dt * cfg.control_decimation;
    for (let k = 0; k < feet.length; k++) {
      const b = feet[k], p = S.footPos[k];
      let x = d.xpos[3 * b], y = d.xpos[3 * b + 1], z = d.xpos[3 * b + 2];
      if (R.footOff) { const M = d.xmat; const [a, bb, c] = R.footOff; x += M[9 * b] * a + M[9 * b + 1] * bb + M[9 * b + 2] * c; y += M[9 * b + 3] * a + M[9 * b + 4] * bb + M[9 * b + 5] * c; z += M[9 * b + 6] * a + M[9 * b + 7] * bb + M[9 * b + 8] * c; }
      const pf = prevFoot[k];
      S.footVel[k] = [(x - pf[0]) / dt, (y - pf[1]) / dt, (z - pf[2]) / dt];
      pf[0] = x; pf[1] = y; pf[2] = z; p[0] = x; p[1] = y; p[2] = z;
      const f = d.cfrc_ext;   // [torque, force] at the subtree COM, world frame
      S.forceZ[k] = f[6 * b + 5];
      S.contact[k] = Math.hypot(f[6 * b + 3], f[6 * b + 4], f[6 * b + 5]) > 1;
    }
  }

  // one value per upstream reward term with a non-zero scale (raw, unscaled)
  function rewardStep() {
    const q = d.qpos, v = d.qvel, dt = cfg.simulation_dt * cfg.control_decimation, rs = R.rewards, out = {};
    toBody(quat(), [v[0], v[1], v[2]], vb);
    gravityOrientation(quat(), g3);
    const sq = x => x * x;
    const T = {
      tracking_lin_vel: () => Math.exp(-(sq(S.cmd[0] - vb[0]) + sq(S.cmd[1] - vb[1])) / SIGMA),
      tracking_ang_vel: () => Math.exp(-sq(S.cmd[2] - v[5]) / SIGMA),
      lin_vel_z: () => sq(vb[2]),
      ang_vel_xy: () => sq(v[3]) + sq(v[4]),
      orientation: () => sq(g3[0]) + sq(g3[1]),
      base_height: () => sq(q[2] - R.heightTarget),
      torques: () => { let s = 0; for (let i = 0; i < NA; i++) s += sq(S.tau[i]); return s; },
      dof_vel: () => { let s = 0; for (let i = 0; i < NA; i++) s += sq(v[6 + i]); return s; },
      dof_acc: () => { let s = 0; for (let i = 0; i < NA; i++) s += sq((lastDq[i] - v[6 + i]) / dt); return s; },
      action_rate: () => { let s = 0; for (let i = 0; i < NA; i++) s += sq(lastA[i] - S.action[i]); return s; },
      dof_pos_limits: () => { let s = 0; for (let i = 0; i < NA; i++) { const x = q[7 + i]; s += Math.max(0, lim[i][0] - x) + Math.max(0, x - lim[i][1]); } return s; },
      alive: () => 1,
      hip_pos: () => { let s = 0; for (const i of hips) s += sq(q[7 + i]); return s; },
      contact_no_vel: () => { let s = 0; S.feet.forEach((_, k) => { if (S.contact[k]) for (const c of S.footVel[k]) s += c * c; }); return s; },
      feet_swing_height: () => { let s = 0; S.feet.forEach((_, k) => { if (!S.contact[k]) s += sq(S.footPos[k][2] - SWING_Z); }); return s; },
      contact: () => { let s = 0; for (let k = 0; k < 2; k++) { const lp = k ? (S.phase + 0.5) % 1 : S.phase; s += (S.forceZ[k] > 1) === (lp < STANCE) ? 1 : 0; } return s; },
      collision: () => { let s = 0; const f = d.cfrc_ext; for (const b of pen) if (Math.hypot(f[6 * b + 3], f[6 * b + 4], f[6 * b + 5]) > 0.1) s++; return s; },
      feet_air_time: () => { let s = 0; for (let k = 0; k < S.feet.length; k++) { const c = S.contact[k] || lastC[k], first = airT[k] > 0 && c; airT[k] += dt; if (first) s += airT[k] - 0.5; if (c) airT[k] = 0; lastC[k] = S.contact[k]; } return Math.hypot(S.cmd[0], S.cmd[1]) > 0.1 ? s : 0; },
    };
    let sum = 0;
    for (const k in rs) { const raw = T[k] ? T[k]() : 0; out[k] = { raw, scale: rs[k], value: raw * rs[k] * dt }; sum += raw * rs[k] * dt; }
    S.rew = out; S.rewSum = Math.max(0, sum);   // only_positive_rewards
    S.rewTotal += S.rewSum;
    for (let i = 0; i < NA; i++) { lastDq[i] = v[6 + i]; lastA[i] = S.action[i]; }
  }

  // Go2: an open-loop trot. Diagonal pairs swing half a period apart; the
  // thigh swings for vx, the hip for vy and yaw, the calf lifts the foot.
  function go2Targets() {
    const ph = S.counter * cfg.simulation_dt % 0.5 / 0.5, [vx, vy, wz] = S.cmd;
    for (let i = 0; i < NA; i++) {
      const j = jn[i], leg = j.slice(0, 2), diag = leg === 'FL' || leg === 'RR' ? 0 : 0.5;
      const p = (ph + diag) % 1, sw = p < 0.5, s = Math.sin(2 * Math.PI * p), lift = sw ? Math.sin(Math.PI * p * 2) : 0;
      const side = leg[1] === 'L' ? 1 : -1;
      let a = 0;
      if (j.endsWith('thigh_joint')) a = -(G2.kx * vx - G2.kw * wz * side) * s;
      else if (j.endsWith('calf_joint')) a = -G2.lift * lift;
      else if (j.endsWith('hip_joint')) a = G2.ky * vy * s;
      S.action[i] = a;
      S.target[i] = q0[i] + a * cfg.action_scale;
    }
  }

  S.reset = () => {
    mj.mj_resetData(m, d);
    if (!R.scene) { d.qpos[2] = 0.33; }
    for (let i = 0; i < NA; i++) { if (!R.policy) d.qpos[7 + i] = q0[i]; }
    mj.mj_forward(m, d);
    S.counter = 0; S.t = 0; S.action.fill(0); S.target.set(q0); S.tau.fill(0); S.obs.fill(0);
    S.cmd.set(S.cmdKeep || cfg.cmd_init);
    S.fallen = false; S.fallT = 0; S.rewTotal = 0; S.rew = {};
    lastDq.fill(0); lastA.fill(0); airT.fill(0); lastC.fill(false);
    if (S.policy) S.policy.reset();
    sense();
  };

  // one physics step: exactly the order of deploy_mujoco.py
  S.step = () => {
    const q = d.qpos, v = d.qvel;
    for (let i = 0; i < NA; i++) S.tau[i] = (S.target[i] - q[7 + i]) * kp[i] + (0 - v[6 + i]) * kd[i];
    for (let a = 0; a < m.nu; a++) d.ctrl[a] = S.tau[actJ[a]];
    mj.mj_step(m, d);
    S.counter++; S.t = S.counter * cfg.simulation_dt;
    if (S.counter % cfg.control_decimation === 0) {
      if (S.policy) {
        makeObs();
        const a = S.policy.step(S.obs);
        S.action.set(a);
        for (let i = 0; i < NA; i++) S.target[i] = a[i] * cfg.action_scale + q0[i];
      } else { S.phase = S.counter * cfg.simulation_dt % PERIOD / PERIOD; go2Targets(); }
      sense();
      rewardStep();
      gravityOrientation(quat(), g3);
      const down = q[2] < R.heightTarget * 0.45 || g3[2] > -0.35;
      S.fallen = down;
      return true;
    }
    return false;
  };

  // training-style push: add a base velocity change (m/s, world xy)
  S.push = (dx, dy) => { d.qvel[0] += dx; d.qvel[1] += dy; S.pushes++; S.lastPush = { t: S.t, dx, dy }; };
  S.setFriction = mu => { S.friction = mu; for (let g = 0; g < m.ngeom; g++) m.geom_friction[3 * g] = fr0[g] * mu; };
  S.setPayload = kg => { S.payload = kg; m.body_mass[pelvis] = mass0 + kg; };
  S.base = () => ({ x: d.qpos[0], y: d.qpos[1], z: d.qpos[2], q: quat() });
  S.bodyVel = () => { toBody(quat(), [d.qvel[0], d.qvel[1], d.qvel[2]], vb); return [vb[0], vb[1], d.qvel[5]]; };
  S.dispose = () => { try { d.delete(); } catch (e) { /* gone */ } try { m.delete(); } catch (e) { /* gone */ } };
  S.reset();
  return S;
}
