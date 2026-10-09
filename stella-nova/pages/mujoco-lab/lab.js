// ============================================================================
//  MUJOCO LAB  ·  lab.js — the page controller without DOM
// ----------------------------------------------------------------------------
//  lab.js holds the current sim and what made it (a library model, a
//  generated scene, or MJCF text from the editor or from disk). It applies
//  the option changes of the visitor, drives the actuators (manual, random,
//  sine), measures the real-time factor, reads the joint, sensor and
//  contact panels, picks bodies with mj_ray, and writes and reads the share
//  link. main.js binds it to the DOM; tests.mjs runs it in node.
//
//  GREP MAP
//    export function createLab ..... the controller
//    lab.load ...................... source -> sim (model, gen, xml)
//    lab.reloadXML ................. compile edited MJCF with the same files
//    lab.setOptions ................ visitor option changes (kept on reload)
//    lab.frame ..................... one display frame: drive, step, timing
//    lab.drive ..................... random and sine control drivers
//    lab.stats ..................... readout numbers (also for __mujoco)
//    lab.jointRows / contactInfo ... panel data
//    lab.pick ...................... mj_ray from a world ray -> body + point
//    export function encodeShare ... state -> url hash
//    export function decodeShare ... url hash -> state
//    export function cameraRay ..... MuJoCo free camera + pixel -> world ray
// ============================================================================
import { loadMuJoCo, createSim, INTEGRATORS, SOLVERS, CONES } from './core/engine.js';
import { MODELS, modelByKey, modelFiles, defaultGet } from './core/models.js';
import { sceneXML, SCENE_KINDS } from './scenes.js';

export { INTEGRATORS, SOLVERS, CONES, MODELS, SCENE_KINDS };
export const OPTION_KEYS = ['timestep', 'integrator', 'solver', 'iterations', 'gravity', 'wind', 'density', 'viscosity', 'cone', 'noslip', 'impratio'];
const JNT = ['free', 'ball', 'slide', 'hinge'];

// ---- share link ----------------------------------------------------------------
// m = model key | g = generated kind; s = seed; o.<short> = option overrides;
// sp = speed; v = visual flags that differ from the defaults; c = camera.
const SHORT = { timestep: 'dt', integrator: 'in', solver: 'so', iterations: 'it', gravity: 'g', wind: 'w', density: 'rho', viscosity: 'mu', cone: 'co', noslip: 'ns', impratio: 'ir' };
const LONG = Object.fromEntries(Object.entries(SHORT).map(([k, v]) => [v, k]));
const num = v => +(+v).toPrecision(6);

export function encodeShare(st) {
  const p = [];
  if (st.kind) p.push('g=' + st.kind); else if (st.model) p.push('m=' + st.model);
  if (st.seed != null && (st.kind || st.seeded)) p.push('s=' + (st.seed >>> 0));
  for (const k of OPTION_KEYS) {
    const v = st.options && st.options[k];
    if (v == null) continue;
    p.push('o.' + SHORT[k] + '=' + encodeURIComponent(Array.isArray(v) ? v.map(num).join(',') : typeof v === 'number' ? num(v) : v));
  }
  if (st.speed != null && st.speed !== 1) p.push('sp=' + num(st.speed));
  if (st.visual && st.visual.length) p.push('v=' + st.visual.join(','));
  if (st.camera) { const c = st.camera; p.push('c=' + [c.azimuth, c.elevation, c.distance, ...c.lookat].map(x => +(+x).toFixed(3)).join(',')); }
  return p.join('&');
}
export function decodeShare(str) {
  const out = { options: {} };
  for (const kv of String(str || '').replace(/^#/, '').split('&')) {
    const i = kv.indexOf('='); if (i < 1) continue;
    let k, v; try { k = decodeURIComponent(kv.slice(0, i)); v = decodeURIComponent(kv.slice(i + 1)); } catch (e) { continue; }
    if (k === 'm' && modelByKey(v)) out.model = v;
    else if (k === 'g' && SCENE_KINDS[v]) out.kind = v;
    else if (k === 's') { const n = parseInt(v, 10); if (isFinite(n)) out.seed = n >>> 0; }
    else if (k === 'sp') { const n = parseFloat(v); if (n > 0 && n <= 4) out.speed = n; }
    else if (k === 'v') out.visual = v.split(',').filter(x => /^[a-z]{2,16}$/.test(x));
    else if (k === 'c') { const a = v.split(',').map(Number); if (a.length === 6 && a.every(isFinite)) out.camera = { azimuth: a[0], elevation: a[1], distance: Math.max(0.01, a[2]), lookat: a.slice(3) }; }
    else if (k.startsWith('o.') && LONG[k.slice(2)]) {
      const key = LONG[k.slice(2)], o = checkOption(key, v);
      if (o !== undefined) out.options[key] = o;
    }
  }
  return out;
}
// one option value from text (or a value), or undefined when it is not valid
export function checkOption(key, v) {
  const n = x => { const y = parseFloat(x); return isFinite(y) ? y : undefined; };
  switch (key) {
    case 'timestep': { const x = n(v); return x > 0 && x <= 0.05 ? x : undefined; }
    case 'integrator': return INTEGRATORS.includes(v) ? v : undefined;
    case 'solver': return SOLVERS.includes(v) ? v : undefined;
    case 'cone': return CONES.includes(v) ? v : undefined;
    case 'iterations': { const x = n(v); return x >= 1 && x <= 1000 ? Math.round(x) : undefined; }
    case 'noslip': { const x = n(v); return x >= 0 && x <= 100 ? Math.round(x) : undefined; }
    case 'gravity': case 'wind': { const a = (Array.isArray(v) ? v : String(v).split(',')).map(Number); return a.length === 3 && a.every(x => isFinite(x) && Math.abs(x) <= 1000) ? a : undefined; }
    case 'density': case 'viscosity': { const x = n(v); return x >= 0 && x <= 1e4 ? x : undefined; }
    case 'impratio': { const x = n(v); return x >= 0.01 && x <= 1000 ? x : undefined; }
  }
  return undefined;
}

// ---- camera ray ------------------------------------------------------------------
// MuJoCo free camera (degrees, z up) -> eye, forward, right, up
export function cameraFrame(c) {
  const az = c.azimuth * Math.PI / 180, el = c.elevation * Math.PI / 180;
  const fwd = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
  const eye = [0, 1, 2].map(i => c.lookat[i] - fwd[i] * c.distance);
  const right = norm(cross(fwd, [0, 0, 1])), up = cross(right, fwd);
  return { eye, fwd, right, up };
}
// pixel (x, y) in a w x h view with vertical field of view fovy (degrees)
export function cameraRay(c, x, y, w, h, fovy = 45) {
  const F = cameraFrame(c), t = Math.tan(fovy * Math.PI / 360);
  const u = (2 * x / w - 1) * t * (w / h), v = (1 - 2 * y / h) * t;
  return { origin: F.eye, dir: norm([0, 1, 2].map(i => F.fwd[i] + u * F.right[i] + v * F.up[i])) };
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ---- the controller --------------------------------------------------------------
export function createLab(opts = {}) {
  const get = opts.get || defaultGet;
  let mj = null, sim = null, src = null, base = null, rayG = null;
  const touched = {};                 // option overrides of the visitor
  const drv = { mode: 'off', amp: 0.6, freq: 0.5, x: null, manual: null };
  const rt = { wall: 0, sim: 0, rtf: 0, lastT: 0 };
  let seedR = 1;
  const lab = {
    get mj() { return mj; }, get sim() { return sim; }, get source() { return src; },
    get baseOptions() { return base; }, get overrides() { return { ...touched }; },
    get driver() { return drv; }, get rtf() { return rt.rtf; },
    async init() { if (!mj) mj = await loadMuJoCo(); return lab; },

    // source: { model, seed? } | { kind, seed } | { xml, files?, name?, camera? }
    async load(source, { keepOptions = false } = {}) {
      await lab.init();
      let spec, entry = null, name, camera, kind = null, seed = source.seed;
      if (source.kind) {
        const g = sceneXML(source.kind, seed ?? 1);
        spec = { xml: g.xml, files: {} }; name = g.name; camera = g.camera; kind = g.kind; seed = g.seed;
      } else if (source.model) {
        entry = modelByKey(source.model);
        if (!entry) throw new Error('No model "' + source.model + '"');
        spec = await modelFiles(entry, { get, seed });
        name = entry.name; camera = entry.camera;
        if (entry.seeded && entry.build && seed != null) { /* the build used the seed */ }
      } else if (source.xml) {
        spec = { xml: source.xml, files: source.files || {} };
        name = source.name || modelName(source.xml) || 'Your model'; camera = source.camera || null;
      } else throw new Error('Nothing to load');
      const next = createSim(mj, { ...spec, name });      // throws on a bad model: the old sim stays
      if (sim) sim.dispose();
      sim = next;
      if (entry) {
        sim.entry = entry;
        if (entry.start && entry.start.key != null) sim.keyframe(entry.start.key);
        if (entry.options) sim.setOptions(entry.options);
        sim.restart = () => { sim.reset(); if (entry.start && entry.start.key != null) sim.keyframe(entry.start.key); return sim; };
      } else sim.restart = () => sim.reset();
      src = { model: entry ? entry.key : null, kind, seed: seed ?? null, seeded: !!(entry && entry.seeded), name, camera: camera || autoCamera(sim), xml: spec.xml, files: spec.files, custom: !entry && !kind };
      base = sim.options();
      if (!keepOptions) for (const k in touched) delete touched[k];
      if (Object.keys(touched).length) sim.setOptions(touched);
      drv.x = new Float64Array(sim.nu); drv.manual = Float64Array.from(sim.d.ctrl);
      rt.wall = rt.sim = 0; rt.rtf = 0; rt.lastT = sim.time;
      if (rayG) { try { rayG.delete(); } catch (e) { /* freed */ } rayG = null; }
      return sim;
    },
    // compile edited MJCF text with the files of the current model
    async reloadXML(xml) {
      const s = src || {};
      return lab.load({ xml, files: s.files || {}, name: modelName(xml) || s.name, camera: s.camera }, { keepOptions: true }).then(S => { src.edited = true; return S; });
    },
    restart() { if (!sim) return; sim.restart(); if (drv.manual) drv.manual.set(sim.d.ctrl); if (drv.x) drv.x.fill(0); rt.lastT = sim.time; },

    setOptions(p) {
      if (!sim) return null;
      const clean = {};
      for (const k in p) { const v = checkOption(k, p[k]); if (v !== undefined) clean[k] = v; }
      if (p.substeps != null) clean.substeps = p.substeps;
      for (const k in clean) if (k !== 'substeps') {
        const same = Array.isArray(clean[k]) ? clean[k].every((x, i) => Math.abs(x - base[k][i]) < 1e-12) : clean[k] === base[k] || (typeof clean[k] === 'number' && Math.abs(clean[k] - base[k]) < 1e-12);
        if (same) delete touched[k]; else touched[k] = clean[k];
      }
      return sim.setOptions(clean);
    },
    resetOptions() { for (const k in touched) delete touched[k]; if (sim && base) sim.setOptions(base); },

    // controls
    setCtrl(i, v) { if (!sim) return; sim.setCtrl(i, v); if (drv.manual) drv.manual[i] = sim.d.ctrl[i]; },
    setDriver(mode, p = {}) { drv.mode = mode; if (p.amp != null) drv.amp = p.amp; if (p.freq != null) drv.freq = p.freq; if (mode === 'off' && sim && drv.manual) sim.d.ctrl.set(drv.manual); },
    ctrlBounds(i) { const [a, b] = sim.ctrlRange(i); return isFinite(a) && isFinite(b) ? [a, b] : [-1, 1]; },
    drive(dt) {
      if (!sim || drv.mode === 'off' || !sim.nu) return;
      const t = sim.time;
      for (let i = 0; i < sim.nu; i++) {
        const [a, b] = lab.ctrlBounds(i), mid = (a + b) / 2, half = (b - a) / 2;
        let u;
        if (drv.mode === 'sine') u = Math.sin(2 * Math.PI * drv.freq * t + i * 2.399963);
        else {   // Ornstein-Uhlenbeck noise, time scale 1 / freq
          const th = Math.max(0.05, drv.freq * 2), x = drv.x[i];
          drv.x[i] = x - th * x * dt + Math.sqrt(2 * th * dt) * gauss();
          u = Math.tanh(drv.x[i]);
        }
        sim.d.ctrl[i] = mid + half * drv.amp * u;
      }
    },

    // one display frame of dt real seconds. Returns the number of steps.
    frame(dt, { playing = true, speed = 1, single = false } = {}) {
      if (!sim) return 0;
      dt = Math.min(Math.max(dt, 0), 0.1);
      let n = 0;
      if (playing) {
        lab.drive(dt * speed);
        const t0 = sim.time;
        n = sim.advance(dt, speed);
        rt.wall += dt; rt.sim += sim.time - t0;
        if (rt.wall >= 0.5) { const r = rt.sim / rt.wall; rt.rtf = rt.rtf ? rt.rtf * 0.4 + r * 0.6 : r; rt.wall = rt.sim = 0; }
      } else if (single) { lab.drive(sim.m.opt.timestep * sim.substeps); sim.step(); n = sim.substeps; }
      if (!isFinite(sim.d.qpos[0] ?? 0) || (sim.nq && !Number.isFinite(sim.d.qvel[0] ?? 0))) lab.lastWarning = 'The state is not finite: reset or change the options.';
      return n;
    },

    stats() {
      if (!sim) return { loaded: false };
      const e = sim.energy();
      return {
        loaded: true, model: src.model, kind: src.kind, seed: src.seed, name: src.name, custom: !!src.custom, edited: !!src.edited,
        time: sim.time, rtf: rt.rtf, steps: sim.stepCount, stepMs: sim.lastStepMs, timestep: sim.m.opt.timestep, substeps: sim.substeps,
        nbody: sim.nbody, ngeom: sim.ngeom, nq: sim.nq, nv: sim.nv, nu: sim.nu, nsensor: sim.m.nsensor, ncon: sim.d.ncon,
        energy: { potential: e[0], kinetic: e[1], total: e[0] + e[1] }, driver: drv.mode, options: sim.options(), overrides: { ...touched },
      };
    },
    jointRows() {
      if (!sim) return [];
      const m = sim.m, q = sim.d.qpos, v = sim.d.qvel, rows = [];
      for (let j = 0; j < m.njnt; j++) {
        const t = m.jnt_type[j], a = m.jnt_qposadr[j], b = m.jnt_dofadr[j];
        const nq = [7, 4, 1, 1][t], nd = [6, 3, 1, 1][t];
        rows.push({ name: sim.jointNames[j] || `joint ${j}`, type: JNT[t], q: Array.from(q.subarray(a, a + nq)), v: Array.from(v.subarray(b, b + nd)), unit: t === 3 ? 'rad' : t === 2 ? 'm' : '' });
      }
      return rows;
    },
    contactInfo(max = 8) {
      if (!sim) return { count: 0, normal: 0, total: [0, 0, 0], maxPen: 0, list: [] };
      const cs = sim.contacts(), tot = [0, 0, 0];
      let normal = 0, maxPen = 0;
      for (const c of cs) { normal += Math.max(0, c.local[0]); for (let i = 0; i < 3; i++) tot[i] += c.force[i]; maxPen = Math.max(maxPen, -c.dist); }
      const gname = g => sim.geomNames[g] || (sim.bodyNames[sim.m.geom_bodyid[g]] ? sim.bodyNames[sim.m.geom_bodyid[g]] + ' geom' : 'geom ' + g);
      const list = cs.slice().sort((a, b) => b.local[0] - a.local[0]).slice(0, max).map(c => ({ a: gname(c.geom1), b: gname(c.geom2), fn: c.local[0], ft: Math.hypot(c.local[1], c.local[2]), pen: -c.dist }));
      return { count: cs.length, normal, total: tot, maxPen, list, contacts: cs };
    },
    // world ray -> nearest geom that is not static: { body, geom, point, dist }
    pick(origin, dir) {
      if (!sim) return null;
      if (!rayG) rayG = new mj.IntBuffer(1);
      let dist;
      try { dist = mj.mj_ray(sim.m, sim.d, origin, dir, null, 0, -1, rayG, null); } catch (e) { return null; }
      const g = rayG.GetView()[0];
      if (!(dist >= 0) || g < 0) return null;
      const body = sim.m.geom_bodyid[g];
      if (body <= 0) return null;
      return { body, geom: g, dist, point: [0, 1, 2].map(i => origin[i] + dir[i] * dist) };
    },
    grab(hit) { if (!sim || !hit) return; sim.perturb(hit.body, sim.worldToLocal(hit.body, hit.point), hit.point, 1); },
    drag(target) { if (sim && sim.perturbBody > 0) sim.setPerturbTarget(target); },
    release() { if (sim) sim.clearPerturb(); },
    get grabbed() { return sim ? sim.perturbBody : -1; },

    shareState(extra = {}) {
      if (!src) return {};
      return { model: src.model, kind: src.kind, seed: src.seed, seeded: src.seeded, options: { ...touched }, ...extra };
    },
    newSeed() { seedR = (seedR * 48271 + Date.now()) % 2147483647; return 1 + (seedR % 999999); },

    dispose() {
      if (rayG) { try { rayG.delete(); } catch (e) { /* freed */ } rayG = null; }
      if (sim) { sim.dispose(); sim = null; }
    },
  };
  return lab;
}

function gauss() { let u = 0; while (!u) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); }
export function modelName(xml) { const m = /<mujoco[^>]*\bmodel="([^"]*)"/.exec(xml || ''); return m ? m[1] : ''; }
// a camera that frames the bodies at the start
export function autoCamera(S) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], n = 0;
  for (let b = 1; b < S.nbody; b++) { const p = S.d.xpos.subarray(3 * b, 3 * b + 3); if (!p.every(Number.isFinite)) continue; n++; for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); } }
  if (!n) return { azimuth: 120, elevation: -25, distance: 3, lookat: [0, 0, 0.5] };
  const c = lo.map((x, i) => (x + hi[i]) / 2), r = Math.max(0.3, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);
  return { azimuth: 120, elevation: -22, distance: r * 3 + 0.5, lookat: c };
}
