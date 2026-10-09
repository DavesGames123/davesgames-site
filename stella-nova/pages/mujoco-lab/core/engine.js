// ============================================================================
//  MUJOCO LAB  ·  core/engine.js — a small wrapper over the MuJoCo WASM build
// ----------------------------------------------------------------------------
//  The vendored build is stella-nova/vendor/mujoco@3.15.0 (Apache-2.0,
//  Google DeepMind, https://github.com/google-deepmind/mujoco). The same file
//  runs in the browser and in node. No DOM is used here.
//
//  GREP MAP
//    export async function loadMuJoCo ... one WASM instance per realm, cached
//    export function heapBytes ......... size of the WASM linear memory
//    export function createSim ......... MJCF + files -> sim object
//    S.step / S.advance ................ fixed timestep, substeps, real time
//    S.reset / S.keyframe .............. state reset
//    S.geomPoses / S.bodyPoses ......... positions and rotations for drawing
//    S.contacts ........................ contact list with mj_contactForce
//    S.sensors / S.setCtrl ............. sensor read and actuator control
//    S.perturb / S.clearPerturb ........ mouse spring on a body (xfrc_applied)
//    S.setOptions / S.options .......... run-time model options
//    S.energy .......................... [potential, kinetic]
//    S.dispose ......................... free MjData, MjModel and buffers
// ============================================================================

const VENDOR = '../../../vendor/mujoco@3.15.0/mujoco.js';
let loading = null, memory = null;

// One instance. We wrap WebAssembly.instantiate* during the load only, to
// keep a reference to the exported memory (the build does not export it).
export function loadMuJoCo() {
  if (loading) return loading;
  loading = (async () => {
    const W = WebAssembly, oi = W.instantiate, os = W.instantiateStreaming;
    const keep = r => { const inst = r && (r.instance || r); if (inst && inst.exports && inst.exports.memory) memory = inst.exports.memory; return r; };
    W.instantiate = function (...a) { return oi.apply(W, a).then(keep); };
    if (os) W.instantiateStreaming = function (...a) { return os.apply(W, a).then(keep); };
    try {
      const { default: load } = await import(new URL(VENDOR, import.meta.url).href);
      return await load();
    } finally { W.instantiate = oi; if (os) W.instantiateStreaming = os; }
  })();
  return loading;
}
export const heapBytes = () => (memory ? memory.buffer.byteLength : 0);

export const INTEGRATORS = ['Euler', 'RK4', 'implicit', 'implicitfast'];
export const SOLVERS = ['PGS', 'CG', 'Newton'];
export const CONES = ['pyramidal', 'elliptic'];
const INT_ENUM = { Euler: 'mjINT_EULER', RK4: 'mjINT_RK4', implicit: 'mjINT_IMPLICIT', implicitfast: 'mjINT_IMPLICITFAST' };
const SOL_ENUM = { PGS: 'mjSOL_PGS', CG: 'mjSOL_CG', Newton: 'mjSOL_NEWTON' };
const CONE_ENUM = { pyramidal: 'mjCONE_PYRAMIDAL', elliptic: 'mjCONE_ELLIPTIC' };

// spec = { xml, files?: { 'path/in/vfs': string | Uint8Array }, name? }
export function createSim(mj, spec) {
  const enc = new TextEncoder(), vfs = new mj.MjVFS();
  let m, d;
  try {
    const files = spec.files || {};
    for (const p in files) vfs.addBuffer(p, typeof files[p] === 'string' ? enc.encode(files[p]) : files[p]);
    m = mj.MjModel.from_xml_string(spec.xml, vfs);
  } finally { vfs.delete(); }
  d = new mj.MjData(m);
  const OBJ = mj.mjtObj;
  const names = (type, n) => { const out = []; for (let i = 0; i < n; i++) out.push(mj.mj_id2name(m, OBJ[type].value, i) || ''); return out; };
  const cf = new mj.DoubleBuffer(6);
  const E = mj.mjtEnableBit.mjENBL_ENERGY.value;
  m.opt.enableflags |= E;   // d.energy is filled by mj_step
  const pert = { body: -1, local: [0, 0, 0], target: [0, 0, 0], k: 1 };
  let disposed = false, acc = 0;

  const S = {
    mj, m, d, name: spec.name || '',
    get nq() { return m.nq; }, get nv() { return m.nv; }, get nu() { return m.nu; },
    get nbody() { return m.nbody; }, get ngeom() { return m.ngeom; }, get time() { return d.time; },
    bodyNames: names('mjOBJ_BODY', m.nbody), geomNames: names('mjOBJ_GEOM', m.ngeom),
    jointNames: names('mjOBJ_JOINT', m.njnt), actuatorNames: names('mjOBJ_ACTUATOR', m.nu),
    sensorNames: names('mjOBJ_SENSOR', m.nsensor), keyNames: names('mjOBJ_KEY', m.nkey),
    substeps: 1, maxStepsPerFrame: 400, lastStepMs: 0, stepCount: 0,

    // n physics steps of m.opt.timestep; perturbation applied before each one
    step(n = this.substeps) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { applyPerturb(); mj.mj_step(m, d); }
      this.stepCount += n;
      this.lastStepMs = (performance.now() - t0) / Math.max(1, n);
      return this;
    },
    // advance by real seconds; whole timesteps only, the rest carries over
    advance(seconds, speed = 1) {
      acc += seconds * speed;
      const dt = m.opt.timestep;
      let n = Math.floor(acc / dt + 1e-9);
      if (n > this.maxStepsPerFrame) { n = this.maxStepsPerFrame; acc = 0; } else acc -= n * dt;
      if (n > 0) this.step(n);
      return n;
    },
    forward() { mj.mj_forward(m, d); return this; },
    reset() { mj.mj_resetData(m, d); acc = 0; mj.mj_forward(m, d); return this; },
    keyframe(k) {
      const i = typeof k === 'string' ? this.keyNames.indexOf(k) : k;
      if (i < 0 || i >= m.nkey) return false;
      mj.mj_resetDataKeyframe(m, d, i); acc = 0; mj.mj_forward(m, d); return true;
    },
    getState() { return { time: d.time, qpos: Float64Array.from(d.qpos), qvel: Float64Array.from(d.qvel), act: Float64Array.from(d.act), ctrl: Float64Array.from(d.ctrl) }; },
    setState(s) { d.time = s.time; d.qpos.set(s.qpos); d.qvel.set(s.qvel); if (s.act) d.act.set(s.act); if (s.ctrl) d.ctrl.set(s.ctrl); mj.mj_forward(m, d); },

    // views into WASM memory: copy if kept across a step
    get qpos() { return d.qpos; }, get qvel() { return d.qvel; },
    get xpos() { return d.xpos; }, get xquat() { return d.xquat; },
    // out: Float32Array(12 * ngeom) = pos(3) + row-major 3x3 rotation(9)
    geomPoses(out = new Float32Array(12 * m.ngeom)) {
      const p = d.geom_xpos, R = d.geom_xmat;
      for (let g = 0; g < m.ngeom; g++) {
        const o = 12 * g;
        out[o] = p[3 * g]; out[o + 1] = p[3 * g + 1]; out[o + 2] = p[3 * g + 2];
        for (let k = 0; k < 9; k++) out[o + 3 + k] = R[9 * g + k];
      }
      return out;
    },
    // out: Float32Array(7 * nbody) = pos(3) + quat(w x y z)
    bodyPoses(out = new Float32Array(7 * m.nbody)) {
      const p = d.xpos, q = d.xquat;
      for (let b = 0; b < m.nbody; b++) { out.set(p.subarray(3 * b, 3 * b + 3), 7 * b); out.set(q.subarray(4 * b, 4 * b + 4), 7 * b + 3); }
      return out;
    },

    // contacts: pos, normal (frame row 0, from geom1 to geom2), force in the
    // contact frame (normal first) and in world coordinates
    contacts() {
      const out = [], vec = d.contact;
      try {
        for (let i = 0; i < d.ncon; i++) {
          const c = vec.get(i);
          try {
            mj.mj_contactForce(m, d, i, cf);
            const f = cf.GetView(), fr = c.frame;
            const w = [0, 1, 2].map(k => f[0] * fr[k] + f[1] * fr[3 + k] + f[2] * fr[6 + k]);
            out.push({ pos: Array.from(c.pos), normal: [fr[0], fr[1], fr[2]], frame: Array.from(fr), dist: c.dist,
              geom1: c.geom[0], geom2: c.geom[1], dim: c.dim, local: Array.from(f), force: w });
          } finally { c.delete && c.delete(); }
        }
      } finally { vec.delete && vec.delete(); }
      return out;
    },

    sensors() {
      const out = [], sd = d.sensordata;
      for (let i = 0; i < m.nsensor; i++) {
        const a = m.sensor_adr[i], n = m.sensor_dim[i];
        out.push({ name: this.sensorNames[i], type: m.sensor_type[i], value: Array.from(sd.subarray(a, a + n)) });
      }
      return out;
    },
    ctrlRange(i) { return m.actuator_ctrllimited[i] ? [m.actuator_ctrlrange[2 * i], m.actuator_ctrlrange[2 * i + 1]] : [-Infinity, Infinity]; },
    setCtrl(i, v) {
      if (typeof i === 'string') i = this.actuatorNames.indexOf(i);
      if (i < 0 || i >= m.nu) return;
      const [a, b] = this.ctrlRange(i); d.ctrl[i] = Math.min(b, Math.max(a, v));
    },

    // raw force and torque on a body, at its centre of mass, world frame
    applyForce(body, f, t = [0, 0, 0]) {
      const x = d.xfrc_applied, o = 6 * body;
      x[o] = f[0]; x[o + 1] = f[1]; x[o + 2] = f[2]; x[o + 3] = t[0]; x[o + 4] = t[1]; x[o + 5] = t[2];
    },
    // spring from a point on the body (body frame) to a world target, as in
    // simulate: F = k * m_subtree * (target - point) - damping * velocity
    perturb(body, localPoint, target, k = 1) {
      if (pert.body > 0 && pert.body !== body) this.applyForce(pert.body, [0, 0, 0]);
      pert.body = body; pert.local = localPoint.slice(); pert.target = target.slice(); pert.k = k;
    },
    setPerturbTarget(target) { pert.target = target.slice(); },
    clearPerturb() { if (pert.body > 0) this.applyForce(pert.body, [0, 0, 0]); pert.body = -1; },
    get perturbBody() { return pert.body; },
    pointWorld(body, local) {
      const R = d.xmat, p = d.xpos, o = 9 * body, [a, b, c] = local;
      return [p[3 * body] + R[o] * a + R[o + 1] * b + R[o + 2] * c, p[3 * body + 1] + R[o + 3] * a + R[o + 4] * b + R[o + 5] * c, p[3 * body + 2] + R[o + 6] * a + R[o + 7] * b + R[o + 8] * c];
    },
    worldToLocal(body, w) {
      const R = d.xmat, p = d.xpos, o = 9 * body, v = [w[0] - p[3 * body], w[1] - p[3 * body + 1], w[2] - p[3 * body + 2]];
      return [0, 1, 2].map(k => R[o + k] * v[0] + R[o + 3 + k] * v[1] + R[o + 6 + k] * v[2]);
    },

    options() {
      const o = m.opt, inv = (E, v) => Object.keys(E).find(k => mj[E === CONE_ENUM ? 'mjtCone' : E === SOL_ENUM ? 'mjtSolver' : 'mjtIntegrator'][E[k]].value === v);
      return {
        timestep: o.timestep, integrator: inv(INT_ENUM, o.integrator), solver: inv(SOL_ENUM, o.solver),
        iterations: o.iterations, tolerance: o.tolerance, gravity: Array.from(o.gravity), wind: Array.from(o.wind),
        density: o.density, viscosity: o.viscosity, cone: inv(CONE_ENUM, o.cone), noslip: o.noslip_iterations, impratio: o.impratio,
      };
    },
    setOptions(p) {
      const o = m.opt;
      if (p.timestep != null) o.timestep = p.timestep;
      if (p.integrator != null) o.integrator = mj.mjtIntegrator[INT_ENUM[p.integrator]].value;
      if (p.solver != null) o.solver = mj.mjtSolver[SOL_ENUM[p.solver]].value;
      if (p.iterations != null) o.iterations = p.iterations | 0;
      if (p.tolerance != null) o.tolerance = p.tolerance;
      if (p.gravity) o.gravity.set(p.gravity);
      if (p.wind) o.wind.set(p.wind);
      if (p.density != null) o.density = p.density;
      if (p.viscosity != null) o.viscosity = p.viscosity;
      if (p.cone != null) o.cone = mj.mjtCone[CONE_ENUM[p.cone]].value;
      if (p.noslip != null) o.noslip_iterations = p.noslip | 0;
      if (p.impratio != null) o.impratio = p.impratio;
      if (p.substeps != null) this.substeps = Math.max(1, p.substeps | 0);
      return this.options();
    },
    // [potential, kinetic]; mj_step fills d.energy, this refreshes it now
    energy() { mj.mj_energyPos(m, d); mj.mj_energyVel(m, d); return [d.energy[0], d.energy[1]]; },
    totalMass() { return mj.mj_getTotalmass(m); },

    dispose() {
      if (disposed) return; disposed = true;
      for (const x of [cf, d, m]) { try { x.delete(); } catch (e) { /* freed */ } }
    },
    get disposed() { return disposed; },
  };

  function applyPerturb() {
    const b = pert.body; if (b <= 0) return;
    const w = S.pointWorld(b, pert.local), mass = m.body_subtreemass[b] || 1;
    const cv = d.cvel, o = 6 * b;   // [ang, lin] at the subtree COM of the root
    // point velocity: lin(com_root) + ang x (w - com_root)
    const root = m.body_rootid[b], c = d.subtree_com;
    const r = [w[0] - c[3 * root], w[1] - c[3 * root + 1], w[2] - c[3 * root + 2]];
    const a = [cv[o], cv[o + 1], cv[o + 2]], l = [cv[o + 3], cv[o + 4], cv[o + 5]];
    const v = [l[0] + a[1] * r[2] - a[2] * r[1], l[1] + a[2] * r[0] - a[0] * r[2], l[2] + a[0] * r[1] - a[1] * r[0]];
    const k = 100 * pert.k * mass, damp = 2 * Math.sqrt(100 * pert.k) * mass;
    const F = [0, 1, 2].map(i => k * (pert.target[i] - w[i]) - damp * v[i]);
    const ci = d.xipos, q = [w[0] - ci[3 * b], w[1] - ci[3 * b + 1], w[2] - ci[3 * b + 2]];
    const T = [q[1] * F[2] - q[2] * F[1], q[2] * F[0] - q[0] * F[2], q[0] * F[1] - q[1] * F[0]];
    S.applyForce(b, F, T);
  }

  mj.mj_forward(m, d);
  return S;
}
