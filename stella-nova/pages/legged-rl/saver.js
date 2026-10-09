// ============================================================================
//  LEGGED ROBOT GYM  ·  saver.js — the screensaver director
// ----------------------------------------------------------------------------
//  main.js loads this module when the shell calls window.snSaver.enter().
//  saver-plan.js gives the shots (kind, robot, command, length, side); this
//  file runs them: it loads the robots a shot needs and frees the others,
//  steps the sims with the scripted command, moves a spring camera to
//  camAt(), and sends the label plate text to the shell.
//
//  SHOT KINDS (saver-plan.js KINDS)
//    dolly, orbit, top (footprints), strike (slow motion, 0.3x), push (a
//    side push with its arrow, then a replay at 0.4x), xray (joint torque
//    glow), sees (observation and action bars drawn in the canvas), front,
//    squad (all four robots abreast; not on a phone).
//
//  CUTS
//    Each cut fades the canvas out, frees the robots that the next shot does
//    not use (MjModel, MjData, THREE geometry), loads the new ones, resets
//    them, puts the camera on its mark and fades in. A shot that ends with a
//    fall cuts early.
//
//  GREP MAP
//    export function startSaver ... enter: hide the GUI, plan, first cut
//    async function cut ........... robots for the next shot
//    function tick ................ sim, replay, camera, HUD, plate
//    function plate ............... label text: robot, command, reward TeX
//    function drawSees ............ the observation / action HUD
// ============================================================================
import * as THREE from 'three';
import { makePlan, cmdAt, camAt, pushVec, KINDS, CMDS, DIM, SQUAD, PARADE, REPLAY, yawOf } from './saver-plan.js';
import { ROBOTS } from './robot.js';
import { bars, obsGroups } from './main.js';

const NAME = { g1: 'Unitree G1', h1: 'Unitree H1', h1_2: 'Unitree H1-2', go2: 'Unitree Go2' };
const RULES = [['v^{*}', 'm1'], ['\\mathbf v', 'm2'], ['\\omega', 'm3'], ['\\tau', 'm4'], ['q^{*}', 'm5'], ['a', 'm6']];
const TEX = {
  track: [String.raw`r_{\text{lin}} = \exp\!\Big(-\frac{\lVert \mathbf v^{*}_{xy}-\mathbf v_{xy}\rVert^2}{0.25}\Big)`, String.raw`r_{\text{yaw}} = \exp\!\Big(-\frac{(\omega^{*}_z-\omega_z)^2}{0.25}\Big)`],
  contact: [String.raw`r_{\text{contact}} = \sum_{k} \mathbb 1\big[c_k = (\phi_k < 0.55)\big]`, String.raw`r_{\text{swing}} = -\sum_{k\,\notin\,c} (z_k - 0.08)^2`],
  strike: [String.raw`r_{\text{slip}} = -\sum_{k\,\in\,c} \lVert \mathbf v_k \rVert^2`, String.raw`\phi = \frac{t \bmod 0.8}{0.8}`],
  push: [String.raw`\tau = K_p\,(q^{*}-q) - K_d\,\dot q`, String.raw`\Delta \mathbf v_{xy} \le 1.5\ \text{m/s every } 5\ \text{s}`],
  torque: [String.raw`\tau = K_p\,(q^{*}-q) - K_d\,\dot q`, String.raw`r_{\tau} = -10^{-5} \sum_j \tau_j^2`],
  sees: [String.raw`a_t = \pi_\theta(o_t,\,h_{t-1}),\qquad q^{*} = q_0 + 0.25\,a_t`, String.raw`o_t = \big[\,0.25\,\omega,\ g_b,\ v^{*},\ q-q_0,\ 0.05\,\dot q,\ a_{t-1},\ \sin 2\pi\phi,\ \cos 2\pi\phi\,\big]`],
  trot: [String.raw`q^{*} = q_0 + 0.25\,a,\qquad a = A \sin 2\pi\phi`, String.raw`\tau = K_p\,(q^{*}-q) - K_d\,\dot q`],
};
const EQ = {
  track: ['r_lin = exp(−|v*xy − vxy|² / 0.25)', 'r_yaw = exp(−(ω*z − ωz)² / 0.25)'],
  contact: ['r_contact = Σ 1[c_k = (φ_k < 0.55)]', 'r_swing = −Σ (z_k − 0.08)² in swing'],
  strike: ['r_slip = −Σ |v_k|² in contact', 'φ = (t mod 0.8) / 0.8'],
  push: ['τ = Kp (q* − q) − Kd q̇', 'Δv ≤ 1.5 m/s every 5 s'],
  torque: ['τ = Kp (q* − q) − Kd q̇', 'r_τ = −1e−5 Σ τ²'],
  sees: ['a = π(o, h)', 'q* = q0 + 0.25 a'],
  trot: ['q* = q0 + 0.25 a', 'a = A sin 2πφ'],
};
const TEXKIND = { dolly: 'track', orbit: 'track', top: 'contact', strike: 'strike', push: 'push', xray: 'torque', sees: 'sees', front: 'track', squad: 'track' };

export function startSaver(G, o = {}) {
  const view = G.view, calm = Math.max(0, Math.min(1, o.calm ?? 0.7)), label = typeof o.label === 'function' ? o.label : () => {};
  const phone = matchMedia('(max-width:768px), (pointer:coarse)').matches;
  const plan = makePlan((o.seed >>> 0) || ((Math.random() * 2 ** 32) >>> 0), 400, { phone });
  const canvas = document.getElementById('view');
  const st = document.createElement('style');
  st.textContent = '.topbar,#panel,#anaPanel,#anaOpen,#dock,#hint,#read,#pad,#fallen,#nogl,#gear,#loading{display:none!important}#stage{top:0!important;bottom:0!important}#view{cursor:none;transition:opacity 0.6s ease}';
  document.head.appendChild(st);
  view.controls.enabled = false;
  view.feetVisible(true);
  const R = {}; // key -> { S, rv, st }
  let shot = null, n = 0, t = 0, busy = true, alive = true, labT = 0, hudT = 0, bandT = 0, bandFn = null;
  let rec = [], replay = null, pushed = false;
  const cam = { p: new THREE.Vector3(), t: new THREE.Vector3(), fov: 36 };
  import('../../lib/saver-clear.js').then(m => { bandFn = m.plateBand; }).catch(() => { /* no band */ });

  const keysOf = s => s.robot === 'all' ? PARADE : [s.robot];
  async function cut() {
    busy = true;
    canvas.style.opacity = '0';
    await new Promise(r => setTimeout(r, 650));
    if (!alive) return;
    shot = plan[n++ % plan.length];
    const need = keysOf(shot);
    for (const k in R) if (!need.includes(k)) { G.freeSim(R[k]); delete R[k]; }
    view.clearFeet();
    try {
      for (const k of need) {
        const off = shot.robot === 'all' ? [0, SQUAD[k]] : [0, 0];
        if (!R[k]) R[k] = await G.buildSim(k, off);
        if (!alive) return;
        R[k].rv.off = off; R[k].st = { feet: true };
        R[k].S.cmdKeep = null; R[k].S.reset(); R[k].S.setFriction(1); R[k].S.setPayload(0);
        R[k].rv.setXray(shot.kind === 'xray');
      }
    } catch (e) { console.error(e); setTimeout(cut, 2000); return; }
    t = 0; rec = []; replay = null; pushed = false; hudT = 1;
    view.hud(null); view.arrow(null, null);
    const c = shotCam(0); cam.p.copy(c.p); cam.t.copy(c.t); cam.fov = c.fov;
    applyCam();
    sendPlate();
    busy = false;
    setTimeout(() => { if (alive) canvas.style.opacity = '1'; }, 120);
  }
  const lead = () => R[shot.lead] || R[keysOf(shot)[0]];
  function center() {
    const L = lead(), b = L.S.base(), yaw = yawOf(b.q);
    if (shot.robot !== 'all') return { x: b.x, y: b.y, z: b.z, yaw };
    let x = 0, y = 0, k = 0;
    for (const key in R) { const q = R[key].S.base(); x += q.x + R[key].rv.off[0]; y += q.y + R[key].rv.off[1]; k++; }
    return { x: x / k, y: y / k, z: b.z, yaw };
  }
  function shotCam(tt) {
    const L = lead(), b = center(), f = L.S.footPos[0];
    const c = camAt(shot, tt, b, DIM[shot.robot === 'all' ? 'h1' : shot.robot], [f[0], f[1], f[2]]);
    return { p: new THREE.Vector3(...c.pos), t: new THREE.Vector3(...c.target), fov: c.fov, b };
  }
  function applyCam() {
    view.camera.position.copy(cam.p); view.controls.target.copy(cam.t);
    view.camera.lookAt(cam.t);
    if (Math.abs(view.camera.fov - cam.fov) > 0.01) { view.camera.fov = cam.fov; view.camera.updateProjectionMatrix(); }
  }

  // ── plate ─────────────────────────────────────────────────────────────────
  const P = (sym, name, value, cls) => ({ sym, name, value, cls });
  function plate() {
    const K = KINDS[shot.kind], L = lead(), S = L.S, scripted = !ROBOTS[S.key].policy;
    const tk = scripted && (shot.kind === 'sees' || shot.kind === 'xray') ? 'trot' : TEXKIND[shot.kind];
    const v = S.bodyVel(), c = S.cmd;
    const title = shot.robot === 'all' ? 'G1 · H1 · H1-2 · Go2' : NAME[S.key];
    const sub = `${K.name} · ${CMDS[shot.cmd].name}${scripted && shot.robot !== 'all' ? ' · scripted trot, no policy' : ' · PPO policy from unitree_rl_gym'}${replay ? ' · replay 0.4×' : K.slow < 1 ? ` · ${K.slow}× speed` : ''}`;
    return {
      title, sub, rules: RULES, tex: TEX[tk], eq: EQ[tk],
      params: [P('v^{*}_x', 'command', `${c[0].toFixed(2)} m/s`, 'm1'), P('\\omega^{*}_z', 'yaw command', `${c[2].toFixed(2)} rad/s`, 'm3'), P('\\mathbf v_x', 'body speed', `${v[0].toFixed(2)} m/s`, 'm2'), P('r', 'reward per step', S.rewSum.toFixed(3), 'm6')],
      notes: [K.sub, scripted ? 'unitree_rl_gym ships no Go2 policy' : 'MuJoCo WASM · deploy_mujoco loop'],
      anchor: () => anchor(),
    };
  }
  let lastLab = '';
  function sendPlate() { const l = plate(), js = JSON.stringify({ ...l, anchor: 0 }); if (js !== lastLab) { lastLab = js; label(l); } }
  const box = new THREE.Box3(), bb = new THREE.Box3(), v3 = new THREE.Vector3();
  function anchor() {
    const r = canvas.getBoundingClientRect(); if (!r.width) return null;
    box.makeEmpty();
    for (const k in R) { R[k].rv.group.updateMatrixWorld(); bb.setFromObject(R[k].rv.group); box.union(bb); }
    if (box.isEmpty()) return null;
    const pts = [];
    for (let i = 0; i < 8; i++) { v3.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(view.camera); if (v3.z < 1) pts.push([r.left + (v3.x + 1) / 2 * r.width, r.top + (1 - v3.y) / 2 * r.height]); }
    if (!pts.length) return null;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x = (Math.min(...xs) + Math.max(...xs)) / 2, y = (Math.min(...ys) + Math.max(...ys)) / 2;
    return { x, y, r: Math.min(r.width, Math.hypot(Math.max(...xs) - x, Math.max(...ys) - y)), pts: [] };
  }

  // ── HUD: what the policy sees ─────────────────────────────────────────────
  function drawSees() {
    const S = lead().S, cl = view.clear(), w = cl.w, h = cl.h;
    const top = cl.t + 8, bot = h - cl.b - 8, bh = Math.max(120, bot - top);
    const v = new THREE.Vector3(...[S.d.qpos[0], S.d.qpos[1], S.d.qpos[2]]).project(view.camera), sx = (v.x + 1) / 2 * w;
    const hw = Math.min(460, w * 0.42), x = sx > w / 2 ? Math.max(12, sx - w * 0.2 - hw) : Math.min(w - hw - 12, sx + w * 0.2);
    const hh = Math.min(bh, 300);
    view.hud({ x, y: top + (bh - hh) / 2, w: hw, h: hh }, (g, W, H) => {
      g.fillStyle = 'rgba(8,9,15,0.55)'; g.strokeStyle = 'rgba(217,179,106,0.35)'; g.lineWidth = 1;
      g.beginPath(); g.roundRect ? g.roundRect(0.5, 0.5, W - 1, H - 1, 10) : g.rect(0.5, 0.5, W - 1, H - 1); g.fill(); g.stroke();
      g.fillStyle = '#ffe0aa'; g.font = '600 13px Inter, system-ui, sans-serif'; g.textAlign = 'left';
      g.fillText(`observation  o  (${S.NO})`, 14, 22);
      bars(g, 12, 30, W - 24, H * 0.5 - 34, S.obs, obsGroups(S.NA), 2.5);
      g.fillStyle = '#ffe0aa'; g.fillText(`action  a  (${S.NA})  →  joint targets`, 14, H * 0.5 + 18);
      const grp = S.jn.map(j => ['', 1, j.startsWith('right') ? '#e9a0a8' : '#8fb0ff']);
      bars(g, 12, H * 0.5 + 26, W - 24, H * 0.5 - 52, S.action, grp, 2, false);
      g.fillStyle = 'rgba(220,221,230,0.6)'; g.font = '11px Inter, system-ui'; g.fillText('left leg', 14, H - 10); g.textAlign = 'right'; g.fillText('right leg', W - 14, H - 10);
    });
  }

  // ── per frame ─────────────────────────────────────────────────────────────
  function stepAll(simDt) {
    for (const k in R) {
      const o2 = R[k], S = o2.S, sd = S.cfg.simulation_dt;
      o2.acc = Math.min((o2.acc || 0) + simDt, 0.1);
      while (o2.acc >= sd) {
        o2.acc -= sd;
        const c = cmdAt(shot.cmd, t); S.cmd[0] = c[0]; S.cmd[1] = c[1]; S.cmd[2] = c[2];
        if (S.step()) G.footPrints(S, o2.rv, o2.st);
      }
    }
  }
  function tick(dt) {
    if (bandFn && (bandT += dt) > 0.5) { bandT = 0; try { G.band = bandFn(canvas.clientHeight); } catch (e) { G.band = null; } }
    if (busy || !shot) return;
    const K = KINDS[shot.kind], L = lead(), S = L.S;
    t += dt;
    if (replay) {
      replay.t += dt * REPLAY.speed;
      while (replay.i < rec.length - 1 && rec[replay.i + 1].t <= replay.t) replay.i++;
      const i = replay.i, fr = rec[i];
      S.d.qpos.set(fr.q); G.mj.mj_kinematics(S.m, S.d);
      view.arrow([fr.x, fr.y, fr.z * 0.75], fr.arrow);
      if (i >= rec.length - 1) {
        S.d.qpos.set(replay.q); S.d.qvel.set(replay.v); G.mj.mj_forward(S.m, S.d);
        replay = null; view.arrow(null, null); sendPlate();
      }
    } else {
      stepAll(dt * K.slow);
      if (shot.kind === 'push') {
        const b = S.base();
        if (!pushed && t >= shot.pushAt) { pushed = { v: pushVec(shot, yawOf(b.q)), t }; S.push(pushed.v[0], pushed.v[1]); }
        const arrowOn = pushed && t - pushed.t < 0.7 ? pushed.v : null;
        view.arrow([b.x, b.y, b.z * 0.75], arrowOn);
        if (t >= shot.pushAt - REPLAY.before && t <= shot.pushAt + REPLAY.after + 0.05) rec.push({ t, q: Float64Array.from(S.d.qpos), x: b.x, y: b.y, z: b.z, arrow: arrowOn });
        if (pushed && t >= pushed.t + REPLAY.after && rec.length && !replay && !L.replayed) {
          L.replayed = true;
          replay = { t: rec[0].t, i: 0, q: Float64Array.from(S.d.qpos), v: Float64Array.from(S.d.qvel) };
          sendPlate();
        }
      }
    }
    // camera: a spring to the shot mark; slower when calm
    const c = shotCam(t * (1 - 0.4 * calm)), k = 1 - Math.exp(-dt * (shot.kind === 'strike' ? 3.5 : 2.2) * (1 - 0.35 * calm));
    cam.p.lerp(c.p, k); cam.t.lerp(c.t, k); cam.fov += (c.fov - cam.fov) * k;
    applyCam();
    view.track([c.b.x, c.b.y]);
    if (shot.kind === 'sees' && !replay && (hudT += dt) > 1 / 30) { hudT = 0; drawSees(); }
    if ((labT += dt) > 1) { labT = 0; sendPlate(); }
    let fell = false; for (const key in R) if (R[key].S.fallen) fell = true;
    if (t >= shot.dur || fell) { for (const key in R) R[key].replayed = false; cut(); }
  }
  function dispose() {
    alive = false;
    for (const k in R) { G.freeSim(R[k]); delete R[k]; }
  }
  cut();
  return { tick, dispose, canvas };
}
