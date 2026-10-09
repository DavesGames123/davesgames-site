// ============================================================================
//  MUJOCO LAB  ·  saver.js — the screensaver director
// ----------------------------------------------------------------------------
//  main.js loads this module when the shell calls window.snSaver.enter().
//  saver-plan.js gives the shots; this file runs them. It loads the model
//  of each shot (lab.load disposes the old MjModel and MjData, and the
//  renderer setSim frees the old scene), sets the driver and the overlay
//  flags, steps the sim, moves a spring camera to camAt(), and sends the
//  label plate to the shell.
//
//  startSaver(env, opts) -> { tick(dt), dispose(), debug(), cut(kind) }
//    env.lab        the lab.js controller
//    env.view       the renderer (render/README.md), or null
//    env.load(src)  load a source and give the sim to the view (Promise)
//    env.setVisual(flags)   renderer flags
//    env.canvas     the 3D canvas (fades between shots), or null
//    opts           shell opts: { calm, seed, label }; also { phone,
//                   fadeMs, band: { t, b } } for tests
//
//  SHOT KINDS (saver-plan.js KINDS)
//    dominoes, rain, tumble (humanoid thrown with a spin), arm (Panda with
//    random controls), drape (cloth, rope or chains), cradle, tippe,
//    collapse (a push and contact-force arrows), replay (live, then the
//    hardest impact again at 0.25x from a saved state), xray.
//
//  GREP MAP
//    export function startSaver ... plan, first cut, the returned hooks
//    async function cut ........... load the next shot, free the last one
//    function setup ............... throw, push, replay setup
//    function focusOf ............. the point the camera follows
//    function tick ................ step, events, replay, camera, plate
//    function plate ............... the label text (no code)
// ============================================================================
import { makePlan, camAt, actionCentre, bandFrame, KINDS, TEX, SHOT_FLAGS, REPLAY, PUSH } from './saver-plan.js';
import { rng } from './core/procedural.js';

const hasDOM = typeof document !== 'undefined';
const CREDIT = 'MuJoCo 3.15.0 · Google DeepMind · Apache-2.0';

export function startSaver(env, o = {}) {
  const lab = env.lab, calm = Math.max(0, Math.min(1, o.calm ?? 0.7)), label = typeof o.label === 'function' ? o.label : () => {};
  const phone = o.phone ?? (hasDOM && typeof matchMedia === 'function' && matchMedia('(max-width:768px), (pointer:coarse)').matches);
  const seed = (o.seed >>> 0) || ((Math.random() * 2 ** 32) >>> 0);
  const plan = makePlan(seed, 400, { phone }), r = rng(seed ^ 0x9e3779b9);
  const fadeMs = o.fadeMs ?? 600;
  let shot = null, n = 0, t = 0, busy = true, alive = true, labT = 0, bandT = 0, band = null, bandFn = null, forced = null;
  let base = null, ev = null, phase = 'live', impact = null, snaps = [], keLast = null;
  const cur = { azimuth: 0, elevation: -20, distance: 3, lookat: [0, 0, 0] }, focus = [0, 0, 0];
  if (o.band) bandFn = () => o.band;                 // a fixed band (tests and probes)
  else if (hasDOM) import('../../lib/saver-clear.js').then(m => { bandFn = m.plateBand; }).catch(() => { /* no band */ });
  const fade = v => { if (env.canvas && env.canvas.style) env.canvas.style.opacity = v; };
  const wait = ms => (ms > 0 ? new Promise(res => setTimeout(res, ms)) : Promise.resolve());

  // cuts run one at a time: a forced cut waits for the cut in progress
  let cutP = Promise.resolve();
  function cut() { busy = true; cutP = cutP.then(doCut, doCut); return cutP; }
  async function doCut() {
    busy = true;
    fade('0');
    await wait(fadeMs);
    if (!alive) return;
    if (forced) { const k = forced; forced = null; shot = makePlan(seed + n, 40, { phone }).find(s => s.kind === k) || plan[n % plan.length]; n++; }
    else shot = plan[n++ % plan.length];
    const K = KINDS[shot.kind];
    lab.setDriver('off');
    try { await env.load(shot.src); } catch (e) { console.error(e); if (alive) setTimeout(cut, 1500); return; }
    if (!alive) return;
    const S = lab.sim;
    const fl = {}; for (const f of SHOT_FLAGS) fl[f] = !!(K.flags && K.flags[f]);
    env.setVisual(fl);
    if (K.driver) lab.setDriver(K.driver[0], K.driver[1]);
    t = 0; phase = 'live'; impact = null; snaps = []; keLast = null; ev = null;
    setup(S, K);
    base = lab.source.camera;
    focusOf(S, K);
    Object.assign(cur, camAt(shot, 0, base, focus, calm));
    applyCam();
    sendPlate();
    busy = false;
    setTimeout(() => { if (alive) fade('1'); }, fadeMs ? 120 : 0);
  }

  function setup(S, K) {
    if (K.setup === 'throw') {
      // root free joint: lift 0.5 m, a sideways throw and a spin
      const v = S.d.qvel, q = S.d.qpos, a = r() * 2 * Math.PI;
      q[2] += 0.5;
      v[0] = Math.cos(a) * 1.2; v[1] = Math.sin(a) * 1.2; v[2] = 3.2;
      v[3] = (r() * 2 - 1) * 5; v[4] = (r() * 2 - 1) * 5; v[5] = (r() * 2 - 1) * 3;
      S.forward();
    } else if (K.setup === 'push') {
      ev = { pushes: PUSH.at.map(at => ({ at, body: -1, on: false, done: false })) };
    }
  }

  // free bodies: bodies whose first joint is a free joint
  function freeBodies(S) {
    const m = S.m, out = [];
    for (let b = 1; b < S.nbody; b++) { const j = m.body_jntadr[b]; if (j >= 0 && m.jnt_type[j] === 0) out.push(b); }
    return out;
  }

  function focusOf(S, K) {
    if (K.focus === 'action') return actionCentre(S.d.xipos, S.d.cvel, S.nbody, focus);
    if (K.focus === 'base') { focus[0] = base.lookat[0]; focus[1] = base.lookat[1]; focus[2] = base.lookat[2]; return focus; }
    let b = S.bodyNames.indexOf(K.focus); if (b < 1) b = 1;
    const p = S.d.subtree_com; focus[0] = p[3 * b]; focus[1] = p[3 * b + 1]; focus[2] = p[3 * b + 2];
    return focus;
  }

  function applyCam() {
    const v = env.view; if (!v) return;
    const h = env.canvas ? env.canvas.clientHeight : 0, w = env.canvas ? env.canvas.clientWidth : 0;
    const bf = bandFrame(h, band);
    v.setCamera({ mode: 'free', azimuth: cur.azimuth, elevation: cur.elevation, distance: cur.distance * bf.k, lookat: cur.lookat });
    const c = v.camera;
    if (c && c.setViewOffset && w > 0 && h > 0) { if (bf.dy) c.setViewOffset(w, h, 0, bf.dy, w, h); else if (c.clearViewOffset) c.clearViewOffset(); c.updateProjectionMatrix(); }
  }

  // ---- per frame -------------------------------------------------------------
  function tick(dt) {
    if (bandFn && (bandT += dt) > 0.5) { bandT = 0; try { band = bandFn(env.canvas ? env.canvas.clientHeight : 0); } catch (e) { band = null; } }
    if (busy || !shot || !lab.sim) return;
    dt = Math.min(Math.max(dt, 0), 0.1);
    const S = lab.sim, K = KINDS[shot.kind];
    t += dt;
    let speed = 1;
    if (K.setup === 'push') pushes(S);
    if (K.setup === 'replay') speed = replayStep(S);
    lab.frame(dt, { playing: true, speed });
    let finite = true; for (let i = 0; i < S.nq; i++) if (!Number.isFinite(S.d.qpos[i])) { finite = false; break; }
    focusOf(S, K);
    const c = camAt(shot, t, base, focus, calm), k = 1 - Math.exp(-dt * 2.4 * (1 - 0.4 * calm));
    cur.azimuth += (c.azimuth - cur.azimuth) * k; cur.elevation += (c.elevation - cur.elevation) * k; cur.distance += (c.distance - cur.distance) * k;
    for (let i = 0; i < 3; i++) cur.lookat[i] += (c.lookat[i] - cur.lookat[i]) * k;
    applyCam();
    if ((labT += dt) > 1) { labT = 0; sendPlate(); }
    const over = K.setup === 'replay' ? phase === 'done' || t > 18 : t >= shot.dur;
    if (over || !finite) cut();
  }

  function pushes(S) {
    for (const p of ev.pushes) {
      if (!p.on && !p.done && t >= p.at) {
        const fb = freeBodies(S); if (!fb.length) { p.done = true; continue; }
        // a body in the lower half of the scene, pushed level toward a random side
        const zs = fb.map(b => S.d.xipos[3 * b + 2]).sort((a, b) => a - b), zmid = zs[Math.floor(zs.length / 2)];
        const low = fb.filter(b => S.d.xipos[3 * b + 2] <= zmid);
        p.body = low[Math.floor(r() * low.length)];
        const a = r() * 2 * Math.PI, f = S.m.body_subtreemass[p.body] * PUSH.acc;
        S.applyForce(p.body, [Math.cos(a) * f, Math.sin(a) * f, 0.15 * f]);
        p.on = true; p.t = t;
      } else if (p.on && t - p.t >= PUSH.len) { S.applyForce(p.body, [0, 0, 0]); p.on = false; p.done = true; }
    }
  }

  // live: keep states and find the largest drop of kinetic energy (the
  // hardest impact). replay: go back to a state before it and run again
  // at 0.25x with the contact forces on. Returns the sim speed.
  function replayStep(S) {
    if (phase === 'live') {
      const st = S.getState(), ke = S.energy()[1];
      snaps.push(st);
      while (snaps.length > 2 && snaps[0].time < st.time - REPLAY.before - 0.2) snaps.shift();
      if (keLast != null && keLast.time < st.time) {
        const drop = (keLast.ke - ke) / (st.time - keLast.time);
        if (st.time > REPLAY.before && (!impact || drop > impact.drop)) {
          // keep the state from REPLAY.before ahead of this impact
          let s0 = snaps[0]; for (const q of snaps) if (q.time <= st.time - REPLAY.before) s0 = q;
          impact = { drop, time: st.time, snap: s0 };
        }
      }
      keLast = { ke, time: st.time };
      if (t >= REPLAY.live && impact) {
        S.setState(impact.snap);
        impact.end = impact.time + REPLAY.after;
        snaps = [];
        phase = 'replay';
        env.setVisual({ contactForces: true, contactPoints: true });
        sendPlate();
      }
      return 1;
    }
    if (phase === 'replay' && S.time >= impact.end) phase = 'done';
    return REPLAY.speed;
  }

  // ---- plate -----------------------------------------------------------------
  function plate() {
    const K = KINDS[shot.kind], S = lab.sim, src = lab.source, e = S.entry, op = S.options();
    const credit = e ? `${e.source.copyright} · ${e.source.licence}` : `Scene made on this site · seed ${src.seed}`;
    const sub = shot.kind === 'replay' ? (phase === 'live' ? 'live: then the hardest impact again' : `replay at ${REPLAY.speed}× from a saved state`) : K.sub;
    return {
      title: shot.kind === 'xray' ? `${src.name} · x-ray` : src.name,
      sub,
      tex: [TEX[K.tex]],
      params: [
        { name: 'solver', value: op.solver }, { name: 'integrator', value: op.integrator },
        { sym: '\\Delta t', name: 'timestep', value: `${+(op.timestep * 1000).toPrecision(3)} ms` },
        { sym: 'n_c', name: 'contacts', value: String(S.d.ncon) },
      ],
      lines: [credit, CREDIT],
    };
  }
  // the same title swaps the text in place on the shell plate (live values)
  function sendPlate() { if (lab.sim && shot) label(plate()); }

  function dispose() { alive = false; busy = true; lab.setDriver('off'); }
  cut();
  return {
    tick, dispose,
    get canvas() { return env.canvas; },
    // probes for tests: the state of the director
    debug: () => ({ kind: shot && shot.kind, n, t, busy, phase, impact: impact && { drop: impact.drop, time: impact.time, end: impact.end, from: impact.snap.time }, cam: { ...cur, lookat: cur.lookat.slice() }, band, plan: plan.slice(0, 12).map(s => s.kind) }),
    // force a shot kind next (tests and probes)
    cut: kind => { forced = kind || null; return cut(); },
    plate: () => (shot && lab.sim ? plate() : null),
  };
}
