// ============================================================================
//  LEGGED ROBOT GYM  ·  main.js — robot choice, drive, push, data, loop
// ----------------------------------------------------------------------------
//  robot.js runs the sim (MuJoCo WASM + the converted policy), scene.js
//  draws it, this file binds the controls. The panel and dock code follows
//  the geneva-cams page.
//
//  TIME
//    The sim steps at the config dt (2 ms). Each frame adds the frame time
//    times the speed (1, 1/2, 1/5) to an account and runs whole steps from
//    it, at most 0.12 s of sim per frame. Pause stops the account. Step
//    runs one control period (control_decimation steps, 20 ms).
//
//  COMMAND
//    The sliders hold the cruise command. While a key or the pad is held,
//    it replaces the cruise value on its axis.
//
//  MEMORY
//    One robot at a time: setRobot frees the old MjModel, MjData and THREE
//    geometry first. pagehide frees all of it and drops the WASM module.
//
//  GREP MAP
//    async function ensureMj ........ load MuJoCo WASM once
//    export async function buildSim .. fetch a robot, compile, add meshes
//    async function setRobot ........ swap the robot in the play view
//    function stepSim ............... the fixed-step loop, slow motion
//    function readCmd ............... sliders + keys + pad -> command
//    function pushDrag .............. drag from the robot to push it
//    function setCam ................ camera presets, follow
//    function drawObs / drawAct ..... observation and action bars
//    function drawJoint ............. joint q, q*, tau over 5 s
//    function fillRewards ........... the reward table
//    function frame ................. the loop
//    window.snSaver ................. screensaver hook (saver.js)
// ============================================================================
import * as THREE from 'three';
import { createView } from './scene.js';
import { loadRobot, ROBOTS, ORDER } from './robot.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const V = '../../vendor/unitree_rl_gym/';

const INFO = {
  g1: { title: 'G1', kind: 'Humanoid · 12 leg joints · trained policy', lede: 'A 1.3 m humanoid. The policy drives the six leg joints of each side: hip pitch, roll and yaw, knee, ankle pitch and roll. The arms are fixed in this 12-joint model.' },
  h1: { title: 'H1', kind: 'Humanoid · 10 leg joints · trained policy', lede: 'A 1.8 m humanoid with one ankle joint per leg, so the observation has 41 numbers instead of 47. Its feet are narrow, so it balances more with the hips.' },
  h1_2: { title: 'H1-2', kind: 'Humanoid · 12 leg joints · trained policy', lede: 'The second H1, with two ankle joints per leg. The MJCF also has arms and hands, held still here. It trains at a 2.5 ms step with decimation 8.' },
  go2: { title: 'Go2', kind: 'Quadruped · scripted trot, no policy', lede: 'unitree_rl_gym has a Go2 training config but ships no pretrained Go2 policy. Here a scripted trot drives it: diagonal leg pairs follow sine targets on the same PD loop. It is not learned and does not react to pushes the way a policy does.' },
};

// ── state ───────────────────────────────────────────────────────────────────
const G = {
  mj: null, view: null, key: null, S: null, rv: null, loading: false,
  paused: false, speed: 1, acc: 0, follow: true, feet: true, xray: false,
  cruise: [0.5, 0, 0], pad: null, keys: new Set(), strafe: false, pushK: 0.7,
  hist: [], histN: 250, joint: 0, fallT: 0, lastBase: null, arrowT: 0, saver: null,
  friction: 1, payload: 0,
};
window.__lrl = G;

let view;
try {
  view = createView({ canvas: $('view'), occluders: [$('panel'), $('anaPanel'), $('dock')], band: () => G.band || null, coarse: COARSE, Renderer: window.__lrlRenderer, onNoGL: () => { $('nogl').hidden = false; } });
} catch (e) { view = null; }
G.view = view;

// ── loading ─────────────────────────────────────────────────────────────────
const bar = $('loadBar'), msg = $('loadMsg');
const setLoad = (text, f) => { $('loading').classList.remove('gone'); msg.textContent = text; bar.style.width = `${Math.round(f * 100)}%`; };
const doneLoad = () => $('loading').classList.add('gone');

// fetch a vendored file. kind: text | json | buf. The body is read to its
// real end (gzip: content-length is the compressed size)
async function get(p, kind) {
  const r = await fetch(new URL(p, import.meta.url));
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return kind === 'text' ? r.text() : kind === 'json' ? r.json() : new Uint8Array(await r.arrayBuffer());
}
G.get = get;

async function ensureMj() {
  if (G.mj) return G.mj;
  if (typeof WebAssembly !== 'object') { $('nowasm').hidden = false; throw new Error('no wasm'); }
  setLoad('physics engine, 2.5 MB', 0.1);
  const { default: load } = await import('../../vendor/mujoco@3.15.0/mujoco.js');
  G.mj = await load();
  return G.mj;
}

// a robot: its Sim and its meshes in the view. off = [x, y] render offset
export async function buildSim(key, off = [0, 0]) {
  const mj = await ensureMj();
  const [S, vis] = await Promise.all([loadRobot(mj, key, get), get(`${V}derived/${key}/visual.bin`, 'buf')]);
  const rv = view ? view.addRobot(mj, S, vis.buffer, off) : null;
  return { S, rv };
}
export function freeSim(o) {
  if (!o) return;
  if (o.rv) o.rv.dispose();
  if (o.S) o.S.dispose();
}
G.buildSim = buildSim; G.freeSim = freeSim;

async function setRobot(key) {
  if (G.loading || !ROBOTS[key]) return;
  G.loading = true;
  try {
    setLoad(G.mj ? `${INFO[key].title}: robot and policy` : 'physics engine, 2.5 MB', 0.2);
    if (!G.mj) await ensureMj();
    setLoad(`${INFO[key].title}: robot and policy`, 0.55);
    freeSim({ S: G.S, rv: G.rv }); G.S = null; G.rv = null;
    if (view) view.clearFeet();
    const o = await buildSim(key);
    G.key = key; G.S = o.S; G.rv = o.rv;
    if (G.rv) G.rv.setXray(G.xray);
    G.S.setFriction(G.friction); G.S.setPayload(G.payload);
    G.hist = []; G.acc = 0; G.fallT = 0; G.lastBase = null;
    fillInfo(); fillCfg(); fillJoints();
    readCmd(); setCam('chase', true);
    history.replaceState(null, '', `#${key}`);
    doneLoad();
  } catch (e) {
    console.error(e);
    $('loading').classList.add('err'); setLoad(`Could not load: ${e.message}`, 0);
  } finally { G.loading = false; }
}
G.setRobot = setRobot;

// ── panel text ──────────────────────────────────────────────────────────────
function buildPicker() {
  const box = $('variants');
  box.innerHTML = ORDER.map(k => `<button class="mv" type="button" data-key="${k}"><b>${INFO[k].title}</b><span>${ROBOTS[k].policy ? 'trained PPO policy' : 'scripted trot'}</span><span class="tag ${ROBOTS[k].policy ? '' : 'scr'}">${ROBOTS[k].policy ? 'policy' : 'no policy'}</span></button>`).join('');
  box.querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => { setRobot(b.dataset.key); if (PHONE_Q.matches) setOpen(false); }));
}
function fillInfo() {
  const I = INFO[G.key];
  $('engTitle').textContent = I.title; $('engKind').textContent = I.kind; $('engLede').textContent = I.lede;
  $('variants').querySelectorAll('.mv').forEach(b => b.classList.toggle('on', b.dataset.key === G.key));
  const dr = ROBOTS[G.key].dr;
  $('drNote').textContent = `Training draws friction in [${dr.friction}] and payload in [${dr.mass}] kg, and pushes up to ${dr.push} m/s every ${dr.pushEvery} s.`;
  $('obsN').textContent = G.S.NO ? `${G.S.NO} numbers` : 'none: scripted';
}
const fmtA = a => '[' + Array.from(a, x => +(+x).toFixed(3)).join(', ') + ']';
function fillCfg() {
  const c = G.S.cfg, P = ROBOTS[G.key].policy;
  const rows = [['simulation_dt', c.simulation_dt + ' s'], ['control_decimation', c.control_decimation], ['kps', fmtA(c.kps)], ['kds', fmtA(c.kds)], ['default_angles', fmtA(c.default_angles)], ['action_scale', c.action_scale], ['ang_vel_scale', c.ang_vel_scale], ['dof_vel_scale', c.dof_vel_scale], ['cmd_scale', fmtA(c.cmd_scale)], ['num_obs / num_actions', `${c.num_obs} / ${c.num_actions}`]];
  $('cfgTable').innerHTML = (P ? '' : '<tr><td colspan="2" style="color:#ffb0b8">Go2: scripted values, not an upstream deploy config</td></tr>') + rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
}
function fillJoints() {
  const sel = $('jointSel');
  sel.innerHTML = G.S.jn.map((j, i) => `<option value="${i}">${j.replace(/_joint$/, '').replace(/_/g, ' ')}</option>`).join('');
  G.joint = Math.min(G.joint, G.S.NA - 1);
  const knee = G.S.jn.findIndex(j => /knee|calf/.test(j));
  if (knee >= 0) G.joint = knee;
  sel.value = String(G.joint);
}
$('jointSel').addEventListener('change', e => { G.joint = +e.target.value; G.hist = []; });

// ── command ─────────────────────────────────────────────────────────────────
const sl = { vx: $('cvx'), vy: $('cvy'), wz: $('cwz') };
function showCruise() {
  $('cvxV').textContent = (+sl.vx.value).toFixed(2); $('cvyV').textContent = (+sl.vy.value).toFixed(2); $('cwzV').textContent = (+sl.wz.value).toFixed(2);
}
for (const k in sl) sl[k].addEventListener('input', () => { G.cruise = [+sl.vx.value, +sl.vy.value, +sl.wz.value]; showCruise(); });
function setCruise(c) { G.cruise = c.slice(); sl.vx.value = c[0]; sl.vy.value = c[1]; sl.wz.value = c[2]; showCruise(); }
$('presets').querySelectorAll('button').forEach(b => b.addEventListener('click', () => setCruise(b.dataset.cmd.split(',').map(Number))));
function readCmd() {
  if (!G.S) return;
  const c = G.cruise.slice(), K = G.keys;
  if (K.has('w') || K.has('arrowup')) c[0] = 0.8;
  if (K.has('s') || K.has('arrowdown')) c[0] = -0.5;
  if (K.has('a') || K.has('arrowleft')) c[2] = 0.8;
  if (K.has('d') || K.has('arrowright')) c[2] = -0.8;
  if (K.has('q')) c[1] = 0.4;
  if (K.has('e')) c[1] = -0.4;
  if (G.pad) { c[0] = G.pad[1]; if (G.strafe) c[1] = -G.pad[0] * 0.6; else c[2] = -G.pad[0]; }
  for (let i = 0; i < 3; i++) G.S.cmd[i] = Math.max(-1, Math.min(1, c[i]));
}
$('tStrafe').addEventListener('click', () => { G.strafe = !G.strafe; $('tStrafe').classList.toggle('on', G.strafe); $('padL').textContent = G.strafe ? 'strafe' : 'turn'; });

// joystick pad: up = forward, sideways = turn (or strafe)
const pad = $('pad'), knob = $('knob');
let padId = null;
function padMove(e) {
  const r = pad.getBoundingClientRect(), R = r.width / 2;
  let x = (e.clientX - r.left - R) / R, y = -(e.clientY - r.top - R) / R;
  const L = Math.hypot(x, y); if (L > 1) { x /= L; y /= L; }
  G.pad = [x, y];
  knob.style.transform = `translate(${x * R * 0.62}px, ${-y * R * 0.62}px)`;
}
pad.addEventListener('pointerdown', e => { padId = e.pointerId; pad.classList.add('drag'); try { pad.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } padMove(e); hideHint(); e.preventDefault(); });
pad.addEventListener('pointermove', e => { if (e.pointerId === padId) padMove(e); });
const padEnd = e => { if (e.pointerId !== padId) return; padId = null; G.pad = null; pad.classList.remove('drag'); knob.style.transform = ''; };
pad.addEventListener('pointerup', padEnd); pad.addEventListener('pointercancel', padEnd);

// keys
const DRIVE = new Set(['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
addEventListener('keydown', e => {
  if (G.saver || e.target.closest && e.target.closest('input,select,textarea')) return;
  const k = e.key.toLowerCase();
  if (DRIVE.has(k)) { G.keys.add(k); hideHint(); e.preventDefault(); }
  else if (k === ' ') { setCruise([0, 0, 0]); e.preventDefault(); }
  else if (k === 'r') resetSim();
  else if (k === 'p') setPaused(!G.paused);
  else if (k === '.') stepOnce();
  else if (k === 'x') setXray(!G.xray);
});
addEventListener('keyup', e => G.keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => G.keys.clear());

// ── push ────────────────────────────────────────────────────────────────────
function push(dx, dy) {
  if (!G.S) return;
  G.S.push(dx, dy);
  G.arrowV = [dx, dy]; G.arrowT = 1.0;
}
$('pushK').addEventListener('input', e => { G.pushK = +e.target.value; $('pushKV').textContent = `${G.pushK.toFixed(2)} m/s`; });
$('pushes').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  // the button says where the push comes from, in the robot frame
  const [fx, fy] = b.dataset.push.split(',').map(Number), q = G.S.base().q;
  const yaw = Math.atan2(2 * (q[0] * q[3] + q[1] * q[2]), 1 - 2 * (q[2] * q[2] + q[3] * q[3]));
  const c = Math.cos(yaw), s = Math.sin(yaw);
  push((c * fx - s * fy) * G.pushK, (s * fx + c * fy) * G.pushK);
}));

// drag from the robot: the arrow follows the pointer on the ground plane,
// the release pushes along it (1.5 m/s per metre, at most 1.5 m/s)
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit = new THREE.Vector3();
let dragP = null;
function pushDrag(e, phase) {
  if (!G.S || !view) return false;
  const cv = $('view'), r = cv.getBoundingClientRect();
  const b = G.S.base(), off = G.rv ? G.rv.off : [0, 0];
  if (phase === 'down') {
    const P = new THREE.Vector3(b.x + off[0], b.y + off[1], b.z * 0.75).project(view.camera);
    const sx = r.left + (P.x + 1) / 2 * r.width, sy = r.top + (1 - P.y) / 2 * r.height;
    const top = new THREE.Vector3(b.x + off[0], b.y + off[1], b.z * 1.4).project(view.camera);
    const hpx = Math.abs((top.y - P.y) / 2 * r.height);
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > Math.max(36, hpx * 1.1)) return false;
    dragP = { id: e.pointerId, v: [0, 0] };
    return true;
  }
  if (!dragP) return false;
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ndc, view.camera);
  plane.constant = -b.z * 0.75;
  if (ray.ray.intersectPlane(plane, hit)) {
    const dx = hit.x - b.x - off[0], dy = hit.y - b.y - off[1], L = Math.hypot(dx, dy), k = Math.min(1.5, L * 1.5) / Math.max(L, 1e-6);
    dragP.v = [dx * k, dy * k];
  }
  if (phase === 'up') { const v = dragP.v; dragP = null; if (Math.hypot(v[0], v[1]) > 0.05) push(v[0], v[1]); return true; }
  G.arrowV = dragP.v; G.arrowT = 1;
  return true;
}
const cvs = $('view');
cvs.addEventListener('pointerdown', e => {
  if (G.saver || e.button > 0) return;
  if (pushDrag(e, 'down')) { e.stopImmediatePropagation(); view.controls.enabled = false; try { cvs.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } hideHint(); }
}, true);
cvs.addEventListener('pointermove', e => { if (dragP && e.pointerId === dragP.id) pushDrag(e, 'move'); });
const dragEnd = e => { if (dragP && e.pointerId === dragP.id) { pushDrag(e, 'up'); view.controls.enabled = true; } };
cvs.addEventListener('pointerup', dragEnd); cvs.addEventListener('pointercancel', dragEnd);

// ── time ────────────────────────────────────────────────────────────────────
function setPaused(p) {
  G.paused = p;
  $('bPause').classList.toggle('on', p); $('bPause').textContent = p ? '▶ Play' : '❚❚ Pause';
  $('dockPlay').innerHTML = p ? '<i>▶</i><span>Play</span>' : '<i>❚❚</i><span>Pause</span>';
  $('dockPlay').setAttribute('aria-label', p ? 'Play' : 'Pause');
}
function setSpeed(s) { G.speed = s; $('speeds').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.speed === s)); }
$('speeds').querySelectorAll('button').forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
$('bPause').addEventListener('click', () => setPaused(!G.paused));
$('dockPlay').addEventListener('click', () => setPaused(!G.paused));
$('bStep').addEventListener('click', () => stepOnce());
$('bReset').addEventListener('click', () => resetSim());
function resetSim() { if (!G.S) return; G.S.reset(); G.hist = []; G.fallT = 0; G.lastBase = null; if (view) view.clearFeet(); setCam(G.camView || 'chase', true); }
function stepOnce() { if (!G.S) return; setPaused(true); readCmd(); for (let i = 0; i < G.S.cfg.control_decimation; i++) stepSim(); }

// domain randomization
const showDR = () => { $('fricV').textContent = G.friction.toFixed(2); $('massV').textContent = `${G.payload >= 0 ? '+' : ''}${G.payload.toFixed(2)} kg`; };
$('fric').addEventListener('input', e => { G.friction = +e.target.value; if (G.S) G.S.setFriction(G.friction); showDR(); });
$('mass').addEventListener('input', e => { G.payload = +e.target.value; if (G.S) G.S.setPayload(G.payload); showDR(); });
$('bRand').addEventListener('click', () => {
  const dr = ROBOTS[G.key].dr, u = (a, b) => a + Math.random() * (b - a);
  G.friction = +u(dr.friction[0], dr.friction[1]).toFixed(2); G.payload = Math.round(u(dr.mass[0], dr.mass[1]) * 4) / 4;
  $('fric').value = G.friction; $('mass').value = G.payload; G.S.setFriction(G.friction); G.S.setPayload(G.payload); showDR();
});

// one physics step of the play robot, with the per-control-step bookkeeping
function stepSim() {
  const S = G.S;
  if (!S.step()) return;
  G.hist.push([S.d.qpos[7 + G.joint], S.target[G.joint], S.tau[G.joint]]);
  if (G.hist.length > G.histN) G.hist.shift();
  footPrints(S, G.rv, G);
  G.dirty = true;
}
// a footprint at each touchdown (contact rising edge)
const FOOT_COL = [0xffe0aa, 0x8fb0ff, 0xe9a0a8, 0x9ee6a0];
export function footPrints(S, rv, st) {
  if (!view || !rv) return;
  st.lastC = st.lastC && st.lastC.length === S.contact.length ? st.lastC : S.contact.map(() => true);
  for (let k = 0; k < S.contact.length; k++) {
    if (S.contact[k] && !st.lastC[k] && st.feet !== false) view.foot(S.footPos[k][0] + rv.off[0], S.footPos[k][1] + rv.off[1], S.key === 'go2' ? 0.035 : 0.06, FOOT_COL[k % 4]);
    st.lastC[k] = S.contact[k];
  }
}
G.footPrints = footPrints;

// ── camera ──────────────────────────────────────────────────────────────────
const yawOf = q => Math.atan2(2 * (q[0] * q[3] + q[1] * q[2]), 1 - 2 * (q[2] * q[2] + q[3] * q[3]));
let tween = null;
function setCam(v, now = false) {
  if (!view || !G.S) return;
  G.camView = v;
  $('views').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  const b = G.S.base(), H = G.key === 'go2' ? 0.45 : G.key === 'g1' ? 1.3 : 1.75, yaw = yawOf(b.q);
  const c = Math.cos(yaw), s = Math.sin(yaw), d = 1.4 + 1.6 * H;
  const rel = { chase: [-d, -0.45 * d, 0.55 * H + 0.35], side: [0.1, -d * 1.05, 0.45 * H + 0.15], front: [d, 0.3 * d, 0.5 * H + 0.2], top: [-0.3, 0.001, 2.2 + 2 * H] }[v] || [-d, -d, H];
  const tgt = new THREE.Vector3(b.x, b.y, 0.5 * H);
  const pos = new THREE.Vector3(b.x + c * rel[0] - s * rel[1], b.y + s * rel[0] + c * rel[1], rel[2]);
  if (now || REDUCED) { view.controls.target.copy(tgt); view.camera.position.copy(pos); tween = null; }
  else tween = { t: 0, p0: view.camera.position.clone(), t0: view.controls.target.clone(), p1: pos, t1: tgt };
}
$('views').querySelectorAll('button').forEach(b => b.addEventListener('click', () => setCam(b.dataset.view)));
const tog = (id, on) => $(id).classList.toggle('on', on);
$('tFollow').addEventListener('click', () => { G.follow = !G.follow; tog('tFollow', G.follow); });
$('tFeet').addEventListener('click', () => { G.feet = !G.feet; tog('tFeet', G.feet); if (view) { view.feetVisible(G.feet); if (!G.feet) view.clearFeet(); } });
function setXray(on) { G.xray = on; tog('tXray', on); if (G.rv) G.rv.setXray(on); }
$('tXray').addEventListener('click', () => setXray(!G.xray));
$('tShadow').addEventListener('click', () => { if (!view) return; view.shadows = !view.shadows; tog('tShadow', view.shadows); });

// ── panels: left controls, right data; on a phone one sheet ─────────────────
const panel = $('panel'), tabs = [...document.querySelectorAll('#dock .tab')], anaSec = $('anaSec'), anaPanel = $('anaPanel');
let grp = 'robot', anaOpen = !PHONE_Q.matches, mathDone = false;
function placeAnalysis() {
  if (PHONE_Q.matches) { if (anaSec.parentNode !== panel) panel.appendChild(anaSec); }
  else if (anaSec.parentNode !== anaPanel) anaPanel.appendChild(anaSec);
  setAna(anaOpen);
}
function setAna(open) {
  anaOpen = open;
  const desk = !PHONE_Q.matches;
  anaPanel.classList.toggle('open', open && desk);
  $('anaOpen').hidden = !desk || open;
  document.body.classList.toggle('ana-open', open && desk);
}
$('anaClose').addEventListener('click', () => setAna(false));
$('anaOpen').addEventListener('click', () => setAna(true));
function setOpen(open, g = grp) {
  grp = g;
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  document.body.classList.toggle('sheet-open', open && PHONE_Q.matches);
  panel.querySelectorAll('.grp').forEach(el => el.classList.toggle('on', el.dataset.grp === grp));
  for (const t of tabs) { const on = open && t.dataset.grp === grp; t.classList.toggle('on', on); t.setAttribute('aria-expanded', String(on)); }
  if (open && PHONE_Q.matches) panel.scrollTop = 0;
  if (open && (grp === 'learn' || !PHONE_Q.matches)) typesetLearn();
}
for (const t of tabs) t.addEventListener('click', () => setOpen(!(panel.classList.contains('open') && grp === t.dataset.grp), t.dataset.grp));
$('gear').addEventListener('click', () => setOpen(true));
$('panelClose').addEventListener('click', () => setOpen(false));
const grip = $('sheetGrip');
let gripY = null;
grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } });
grip.addEventListener('pointerup', e => {
  if (gripY === null) return;
  const dy = e.clientY - gripY; gripY = null;
  if (Math.abs(dy) < 8) panel.classList.toggle('full');
  else if (dy < -40) panel.classList.add('full');
  else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
});
grip.addEventListener('pointercancel', () => { gripY = null; });
function typesetLearn() {
  if (mathDone) return; mathDone = true;
  import('../../lib/sci-math.js').then(m => m.typesetAll($('learn'))).catch(() => { /* raw TeX stays */ });
}
let hintGone = false;
function hideHint() { if (!hintGone) { hintGone = true; $('hint').classList.add('gone'); } }
if (COARSE) $('hint').textContent = 'drive with the pad · drag the robot to push it · drag elsewhere to orbit';
setTimeout(hideHint, 10000);

// ── data plots ──────────────────────────────────────────────────────────────
function ctx2d(cv) {
  const w = cv.clientWidth, h = cv.clientHeight, p = Math.min(2, devicePixelRatio || 1);
  if (!w || !h) return null;
  if (cv.width !== Math.round(w * p) || cv.height !== Math.round(h * p)) { cv.width = Math.round(w * p); cv.height = Math.round(h * p); }
  const g = cv.getContext('2d'); g.setTransform(p, 0, 0, p, 0, 0); g.clearRect(0, 0, w, h);
  return { g, w, h };
}
// the observation groups of deploy_mujoco.py, with their colours
export function obsGroups(NA) {
  return [['ω', 3, '#62c4ff'], ['g', 3, '#a8a4ff'], ['cmd', 3, '#ffd666'], ['q−q₀', NA, '#86dc7c'], ['q̇', NA, '#ff9a62'], ['a', NA, '#e889dc'], ['φ', 2, '#ffe0aa']];
}
// vertical bars, one per value, centred, clipped to ±lim. Shared with the saver HUD.
export function bars(g, x, y, w, h, vals, groups, lim, labels = true) {
  const n = vals.length, bw = w / n, mid = y + h / 2;
  g.strokeStyle = 'rgba(217,179,106,0.18)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x, mid + 0.5); g.lineTo(x + w, mid + 0.5); g.stroke();
  let i = 0;
  for (const [name, cnt, col] of groups) {
    const x0 = x + i * bw;
    g.fillStyle = col;
    for (let k = 0; k < cnt && i < n; k++, i++) {
      const v = Math.max(-1, Math.min(1, vals[i] / lim)), bh = v * (h / 2 - 2);
      g.globalAlpha = 0.9; g.fillRect(x + i * bw + 0.5, bh > 0 ? mid - bh : mid, Math.max(1, bw - 1.2), Math.max(1, Math.abs(bh)));
    }
    g.globalAlpha = 1;
    if (labels) { g.fillStyle = 'rgba(220,221,230,0.7)'; g.font = '10px Inter, system-ui, sans-serif'; g.textAlign = 'left'; g.fillText(name, x0 + 1, y + 10); }
  }
}
function drawObs() {
  const c = ctx2d($('obsPlot')); if (!c) return;
  const S = G.S;
  if (!S.NO) { c.g.fillStyle = '#8d90a6'; c.g.font = '12px Inter, system-ui'; c.g.fillText('Go2: no policy, so no observation.', 10, 24); return; }
  bars(c.g, 4, 4, c.w - 8, c.h - 8, S.obs, obsGroups(S.NA), 2.5);
}
function drawAct() {
  const c = ctx2d($('actPlot')); if (!c) return;
  const S = G.S, groups = S.jn.map(j => [j.replace(/^(left|right)_/, (m, s) => s[0].toUpperCase()).replace(/_joint$/, '').replace(/hip_/, 'h.').replace(/ankle_/, 'a.').replace(/_/g, ' ').slice(0, 8), 1, j.startsWith('right') || /^(FR|RR)/.test(j) ? '#e9a0a8' : '#8fb0ff']);
  bars(c.g, 4, 14, c.w - 8, c.h - 18, S.action, groups.map(x => [x[0], 1, x[2]]), 2, false);
  c.g.fillStyle = 'rgba(220,221,230,0.6)'; c.g.font = '9px Inter, system-ui'; c.g.textAlign = 'center';
  const bw = (c.w - 8) / S.NA;
  S.jn.forEach((j, i) => c.g.fillText(groups[i][0].split(' ')[0], 4 + (i + 0.5) * bw, 10));
}
function drawJoint() {
  const c = ctx2d($('jointPlot')); if (!c) return;
  const { g, w, h } = c, H = G.hist;
  if (H.length < 2) return;
  let lo = Infinity, hi = -Infinity, tm = 1;
  for (const r of H) { lo = Math.min(lo, r[0], r[1]); hi = Math.max(hi, r[0], r[1]); tm = Math.max(tm, Math.abs(r[2])); }
  const pad = Math.max(0.05, (hi - lo) * 0.15); lo -= pad; hi += pad;
  const X = i => 4 + (i / (G.histN - 1)) * (w - 8), Y = v => h - 4 - (v - lo) / (hi - lo) * (h - 8), YT = v => h / 2 - v / tm * (h / 2 - 6);
  g.strokeStyle = 'rgba(217,179,106,0.12)'; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  const line = (f, col, dash) => { g.strokeStyle = col; g.lineWidth = 1.5; g.setLineDash(dash || []); g.beginPath(); H.forEach((r, i) => { const y = f(r); i ? g.lineTo(X(i), y) : g.moveTo(X(i), y); }); g.stroke(); g.setLineDash([]); };
  line(r => YT(r[2]), 'rgba(255,106,122,0.8)');
  line(r => Y(r[1]), '#ffe0aa', [4, 3]);
  line(r => Y(r[0]), '#8fb0ff');
  g.fillStyle = 'rgba(220,221,230,0.65)'; g.font = '10px ui-monospace, Menlo, monospace'; g.textAlign = 'right';
  const L = H[H.length - 1];
  g.fillText(`q ${L[0].toFixed(2)} rad  q* ${L[1].toFixed(2)}  τ ${L[2].toFixed(1)} N·m`, w - 6, 12);
}
const REW_TEX = {
  tracking_lin_vel: 'exp(−|v*xy − vxy|²/σ)', tracking_ang_vel: 'exp(−(ω*z − ωz)²/σ)', lin_vel_z: 'vz²', ang_vel_xy: 'ωx² + ωy²', orientation: 'gx² + gy²',
  base_height: '(z − z*)²', torques: 'Σ τ²', dof_vel: 'Σ q̇²', dof_acc: 'Σ q̈²', action_rate: 'Σ (a − a₋₁)²', dof_pos_limits: 'Σ over soft limit', alive: '1',
  hip_pos: 'Σ hip roll, yaw²', contact_no_vel: 'Σ foot v² in contact', feet_swing_height: 'Σ (z_foot − 0.08)² in swing', contact: 'Σ contact = stance phase',
  collision: 'count of hip/knee hits', feet_air_time: 'Σ (t_air − 0.5) at touchdown',
};
function fillRewards() {
  const S = G.S, R = S.rew;
  let html = '<tr><th>term</th><th>scale</th><th>raw</th><th>× scale × dt</th></tr>', sum = 0;
  for (const k in R) {
    const r = R[k]; sum += r.value;
    html += `<tr title="${REW_TEX[k] || ''}"><td>${k.replace(/_/g, ' ')}</td><td>${r.scale}</td><td>${fmt(r.raw)}</td><td class="${r.value >= 0 ? 'pos' : 'neg'}">${r.value.toFixed(4)}</td></tr>`;
  }
  html += `<tr class="tot"><td>step total (≥ 0)</td><td></td><td></td><td>${Math.max(0, sum).toFixed(4)}</td></tr><tr class="tot"><td>episode</td><td></td><td></td><td>${S.rewTotal.toFixed(2)}</td></tr>`;
  $('rewTable').innerHTML = html;
}
const fmt = x => Math.abs(x) >= 1000 ? x.toExponential(1) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toFixed(3);
function readout() {
  const S = G.S, v = S.bodyVel(), c = S.cmd, b = S.base();
  $('read').innerHTML = `<span class="hi">${INFO[G.key].title}</span> <span class="lo">${ROBOTS[G.key].policy ? 'policy' : 'scripted trot'} · t ${S.t.toFixed(1)} s${G.speed < 1 ? ` · ${G.speed}×` : ''}${G.paused ? ' · paused' : ''}</span><br>`
    + `<span class="k">cmd</span> <span class="m1">${c[0].toFixed(2)}</span> <span class="m2">${c[1].toFixed(2)}</span> <span class="m3">${c[2].toFixed(2)}</span> <span class="k">body</span> <span class="m1">${v[0].toFixed(2)}</span> <span class="m2">${v[1].toFixed(2)}</span> <span class="m3">${v[2].toFixed(2)}</span><br>`
    + `<span class="k">height</span> ${b.z.toFixed(2)} m <span class="k">reward</span> ${S.rewSum.toFixed(3)}`;
}

// ── loop ────────────────────────────────────────────────────────────────────
let raf = 0, last = performance.now(), running = true, uiT = 0, plotT = 0;
const tmp = new THREE.Vector3();
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now;
  if (G.saver) { G.saver.tick(dt); if (view) view.frame(dt); return; }
  const S = G.S;
  if (S && !G.loading) {
    readCmd();
    if (!G.paused) {
      G.acc = Math.min(G.acc + dt * G.speed, 0.12);
      const sd = S.cfg.simulation_dt;
      while (G.acc >= sd) { G.acc -= sd; stepSim(); }
    }
    if (S.fallen) { G.fallT += G.paused ? 0 : dt; if (G.fallT > 2) resetSim(); } else G.fallT = 0;
    $('fallen').hidden = !S.fallen;
    const b = S.base();
    if (view) {
      if (tween) {
        tween.t = Math.min(1, tween.t + dt / 0.9); const k = tween.t * tween.t * (3 - 2 * tween.t);
        view.controls.target.lerpVectors(tween.t0, tween.t1, k); view.camera.position.lerpVectors(tween.p0, tween.p1, k);
        if (tween.t >= 1) tween = null;
      } else if (G.follow && G.lastBase && !dragP) {
        tmp.set(b.x - G.lastBase[0], b.y - G.lastBase[1], 0);
        view.controls.target.add(tmp); view.camera.position.add(tmp);
      }
      G.lastBase = [b.x, b.y];
      view.track([b.x, b.y]);
      G.arrowT = Math.max(0, G.arrowT - dt);
      view.arrow([b.x, b.y, b.z * 0.75], G.arrowT > 0 ? G.arrowV : null);
    }
    if ((uiT += dt) > 0.1) { uiT = 0; readout(); }
    if (anaOpen || (PHONE_Q.matches && grp === 'data' && panel.classList.contains('open'))) {
      if ((plotT += dt) > 0.066 && G.dirty) { plotT = 0; G.dirty = false; drawObs(); drawAct(); drawJoint(); }
      if ((G.rewT = (G.rewT || 0) + dt) > 0.25) { G.rewT = 0; fillRewards(); }
    }
  }
  if (view) view.frame(dt);
}
function release() {
  running = false; cancelAnimationFrame(raf);
  try { if (G.saver && G.saver.dispose) G.saver.dispose(); } catch (e) { /* gone */ }
  freeSim({ S: G.S, rv: G.rv }); G.S = null; G.rv = null;
  if (view) view.dispose();
  G.mj = null;
}
window.addEventListener('pagehide', release);

// ── screensaver ─────────────────────────────────────────────────────────────
// Hook for the shell (lib/screensaver.js). enter() frees the play robot
// and hands the loop to saver.js (shots from saver-plan.js). No exit():
// the shell reloads the page.
window.snSaver = {
  enter(o = {}) {
    G.saver = { tick() {} };
    G.keys.clear(); G.pad = null;
    freeSim({ S: G.S, rv: G.rv }); G.S = null; G.rv = null;
    setOpen(false); setAna(false);
    import('./saver.js').then(m => { if (G.saver && running) G.saver = m.startSaver(G, o); }).catch(e => console.error(e));
    return { canvas: $('view'), warmupMs: 2500 };
  },
};

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
placeAnalysis();
setOpen(!PHONE_Q.matches);
PHONE_Q.addEventListener('change', e => { placeAnalysis(); setOpen(!e.matches); });
setCruise(G.cruise); setSpeed(1); setPaused(false); showDR();
$('pushKV').textContent = `${G.pushK.toFixed(2)} m/s`;
const start = (location.hash || '').slice(1);
if (view) setRobot(ROBOTS[start] ? start : 'g1');
else doneLoad();
requestAnimationFrame(frame);
