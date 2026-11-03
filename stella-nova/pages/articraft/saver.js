// ============================================================================
//  ARTICRAFT PLAYGROUND  ·  saver.js — the screensaver hook and director
// ----------------------------------------------------------------------------
//  This module sets window.snSaver = { enter(opts), exit() } (lib/screensaver.js
//  has the protocol). The page must load this module: index.html
//  <script type="module" src="saver.js"> or an import in main.js.
//
//  enter({ calm, seconds, caption, seed, label }) -> { canvas, warmupMs }
//      Hides the page GUI and sets window.snSaverActive = true (main.js can
//      stop its own loop on it). Puts a full-frame canvas in the document,
//      loads MuJoCo, the manifest and one object for each shot. Each shot
//      is one object, Anchored, driven along poseAt() from sim.js, with a
//      slow orbit. plateBand(h) from lib/saver-clear.js frames the object
//      in the clear band of the label plate.
//  exit()   stops the loop, frees the sim and the renderer, removes the canvas.
//
//  The plan and the director have no DOM, so saver-tests.mjs runs them in
//  node with stubs and with the real sim.js.
//
//  makePlan(seed, objects, n, { phone }) -> [shot]
//      A seeded shuffle bag of the objects with joints. The bag is shuffled
//      again when it is empty, and one object never comes twice in a row.
//      shot = { slug, dur (5 to 12 s), az0, dir, el, period, phase0 }.
//  camAt(shot, t, centre, extent, calm) -> { azimuth, elevation, distance, lookat }
//  bandFrame(h, band) -> { k, dy }   distance factor and view offset for the band
//  startSaver(env, opts) -> { tick(dt), dispose(), debug(), cut(), plate() }
//      env = { objects, load(entry) -> Promise<S>, poseAt, setTargets,
//              view (renderer or null), canvas (or null) }
//
//  GREP MAP
//    export function makePlan ..... seeded bag, no back-to-back repeats
//    export function camAt ........ the orbit camera of a shot
//    export function startSaver ... the director: cut, tick, plate
//    function doCut ............... load the next object, free the last one
//    function plate ............... the label text (no code)
//    window.snSaver ............... the browser hook (enter, exit)
// ============================================================================
import { rng } from '../mujoco-lab/core/procedural.js';

const hasDOM = typeof document !== 'undefined';
export const DUR = [5, 12];
export const CREDIT_MJ = 'MuJoCo 3.15.0 · Google DeepMind · Apache-2.0';
export const PAPER = 'Zhou et al. 2026, Articraft, arXiv:2605.15187';
// Position actuator law: torque from the target error and the joint speed.
export const TEX = String.raw`\tau = k_p\,(q^{*} - q) - k_v\,\dot q`;
// A phone gets the smaller objects only (bytes of model.xml and meshes).
export const PHONE_BYTES = 260000;

const seedOf = r => 1 + Math.floor(r() * 999998);

export function makePlan(seed, objects, n = 200, { phone = false } = {}) {
  let pool = (objects || []).filter(o => o && o.slug && Array.isArray(o.joints) && o.joints.length > 0);
  if (phone) { const small = pool.filter(o => !(o.bytes > PHONE_BYTES)); if (small.length >= 3) pool = small; }
  const out = [];
  if (!pool.length) return out;
  const r = rng((seed >>> 0) || 1), slugs = pool.map(o => o.slug);
  let bag = [];
  while (out.length < n) {
    if (!bag.length) {
      bag = slugs.slice();
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      const last = out.length ? out[out.length - 1].slug : null;
      // pop() takes from the end: never the last object again
      if (bag.length > 1 && bag[bag.length - 1] === last) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    }
    const slug = bag.pop();
    const dur = Math.min(DUR[1], Math.max(DUR[0], 7 + r() * 4));
    out.push({
      slug, dur: +dur.toFixed(2),
      az0: Math.floor(r() * 360), dir: r() < 0.5 ? -1 : 1, el: -14 - r() * 14,
      period: +(5 + r() * 3).toFixed(2), phase0: +r().toFixed(3), seed: seedOf(r),
    });
  }
  return out;
}

const lerp = (a, b, s) => a + (b - a) * s;
// centre: the point to look at (MuJoCo world); extent: bounding sphere radius
export function camAt(shot, t, centre, extent, calm = 0.7) {
  const s = Math.min(1, Math.max(0, t / shot.dur)), e = s * s * (3 - 2 * s);
  const rate = 7 * (1 - 0.45 * calm);   // deg/s
  const R = Math.max(0.02, extent || 0.3);
  // fovy 45: a sphere of radius R fills the frame at R / sin(22.5 deg) = 2.61 R
  return {
    azimuth: shot.az0 + shot.dir * rate * t,
    elevation: Math.max(-60, Math.min(-3, shot.el)),
    distance: R * lerp(3.1, 2.7, e),
    lookat: [centre[0], centre[1], centre[2]],
  };
}

// h: canvas CSS height; band: plateBand(h) or null
export function bandFrame(h, band) {
  if (!band || !(h > 0)) return { k: 1, dy: 0 };
  const clear = Math.max(h * 0.3, h - band.t - band.b);
  return { k: Math.min(2.2, Math.max(1, h / clear)), dy: (band.b - band.t) / 2 };
}

// The target of each joint at a phase, cut to the joint range. sim.js poseAt
// is the source; the cut is a guard against a bad range in the manifest.
export function clampPose(entry, pose) {
  const out = {};
  for (const j of entry.joints || []) {
    let v = pose ? pose[j.name] : undefined;
    if (!Number.isFinite(v)) continue;
    if (Array.isArray(j.range) && j.range.length === 2 && j.range[0] < j.range[1]) v = Math.min(j.range[1], Math.max(j.range[0], v));
    out[j.name] = v;
  }
  return out;
}

export function startSaver(env, o = {}) {
  const calm = Math.max(0, Math.min(1, o.calm ?? 0.7)), label = typeof o.label === 'function' ? o.label : () => {};
  const phone = o.phone ?? (hasDOM && typeof matchMedia === 'function' && matchMedia('(max-width:768px), (pointer:coarse)').matches);
  const seed = (o.seed >>> 0) || ((Math.random() * 2 ** 32) >>> 0);
  const objects = env.objects || [];
  const bySlug = new Map(objects.map(e => [e.slug, e]));
  const plan = makePlan(seed, objects, 400, { phone });
  const fadeMs = o.fadeMs ?? 600;
  let shot = null, entry = null, S = null, n = 0, t = 0, busy = true, alive = true, bandT = 0, band = null, bandFn = null;
  let fails = 0, lastPose = null;
  const cur = { azimuth: 0, elevation: -20, distance: 1, lookat: [0, 0, 0] }, centre = [0, 0, 0];
  if (o.band) bandFn = () => o.band;
  else if (hasDOM) import('../../lib/saver-clear.js').then(m => { bandFn = m.plateBand; }).catch(() => { /* no band */ });
  const fade = v => { if (env.canvas && env.canvas.style) env.canvas.style.opacity = v; };
  const wait = ms => (ms > 0 ? new Promise(res => setTimeout(res, ms)) : Promise.resolve());

  let cutP = Promise.resolve();
  function cut() { busy = true; cutP = cutP.then(doCut, doCut); return cutP; }
  async function doCut() {
    busy = true;
    if (!plan.length) return;
    fade('0');
    await wait(fadeMs);
    if (!alive) return;
    const next = plan[n++ % plan.length], e = bySlug.get(next.slug);
    let S2;
    try { S2 = await env.load(e); } catch (err) {
      console.error(err);
      // a bad object: go on to the next one, but stop after a run of failures
      if (alive && ++fails < 8) setTimeout(cut, 300);
      return;
    }
    if (!alive) { try { S2.dispose(); } catch (x) { /* freed */ } return; }
    fails = 0;
    const old = S;
    S = S2; shot = next; entry = e; t = 0;
    if (env.view) env.view.setSim(S);
    if (old && old !== S) { try { old.dispose(); } catch (x) { /* freed */ } }
    drive(0);
    try { S.forward && S.forward(); } catch (x) { /* no forward */ }
    findCentre();
    Object.assign(cur, camAt(shot, 0, centre, entry.extent, calm));
    applyCam();
    label(plate());
    busy = false;
    setTimeout(() => { if (alive) fade('1'); }, fadeMs ? 120 : 0);
  }

  // the subtree centre of mass of the root body, raised toward the middle of
  // the bounding sphere (the object rests on z = 0)
  function findCentre() {
    let b = S.bodyNames ? S.bodyNames.indexOf('root') : -1; if (b < 1) b = 1;
    const c = S.d && S.d.subtree_com;
    const R = entry.extent || 0.3;
    if (c && c.length >= 3 * b + 3) { centre[0] = c[3 * b]; centre[1] = c[3 * b + 1]; centre[2] = Math.max(c[3 * b + 2], R * 0.55); }
    else { centre[0] = 0; centre[1] = 0; centre[2] = R * 0.6; }
    for (let i = 0; i < 3; i++) if (!Number.isFinite(centre[i])) centre[i] = 0;
  }

  function drive(time) {
    const ph = ((shot.phase0 + time / shot.period) % 1 + 1) % 1;
    lastPose = clampPose(entry, env.poseAt(entry, ph));
    env.setTargets(S, lastPose);
  }

  function applyCam() {
    const v = env.view; if (!v) return;
    const h = env.canvas ? env.canvas.clientHeight : 0, w = env.canvas ? env.canvas.clientWidth : 0;
    const bf = bandFrame(h, band);
    v.setCamera({ mode: 'free', azimuth: cur.azimuth, elevation: cur.elevation, distance: cur.distance * bf.k, lookat: cur.lookat });
    const c = v.camera;
    if (c && c.setViewOffset && w > 0 && h > 0) { if (bf.dy) c.setViewOffset(w, h, 0, bf.dy, w, h); else if (c.clearViewOffset) c.clearViewOffset(); c.updateProjectionMatrix(); }
  }

  function tick(dt) {
    if (bandFn && (bandT += dt) > 0.5) { bandT = 0; try { band = bandFn(env.canvas ? env.canvas.clientHeight : 0); } catch (e) { band = null; } }
    if (busy || !shot || !S) return;
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    t += dt;
    drive(t);
    S.advance(dt);
    let finite = true;
    const q = S.d && S.d.qpos;
    if (q) for (let i = 0; i < q.length; i++) if (!Number.isFinite(q[i])) { finite = false; break; }
    const c = camAt(shot, t, centre, entry.extent, calm), k = 1 - Math.exp(-dt * 2.4 * (1 - 0.4 * calm));
    cur.azimuth += (c.azimuth - cur.azimuth) * k; cur.elevation += (c.elevation - cur.elevation) * k; cur.distance += (c.distance - cur.distance) * k;
    for (let i = 0; i < 3; i++) cur.lookat[i] += (c.lookat[i] - cur.lookat[i]) * k;
    applyCam();
    if (t >= shot.dur || !finite) cut();
  }

  function plate() {
    const e = entry, g = (env.groups || []).find(x => x.id === e.group);
    let mass = null; try { mass = S.totalMass ? S.totalMass() : null; } catch (x) { mass = null; }
    const params = [{ sym: 'n', name: 'joints', value: String(e.joints.length) }];
    if (Number.isFinite(mass)) params.push({ sym: 'm', name: 'mass', value: `${mass < 1 ? (mass * 1000).toFixed(0) + ' g' : mass.toFixed(2) + ' kg'}` });
    if (Number.isFinite(e.extent)) params.push({ sym: 'r', name: 'size', value: `${(e.extent * 100).toFixed(0)} cm` });
    return {
      title: e.title,
      sub: `${g ? g.title : e.category} · joints driven to a moving target`,
      tex: [TEX],
      params,
      lines: [`${e.record} · ${e.author} · Articraft dataset, CC BY 4.0`, `${PAPER} · ${CREDIT_MJ}`],
    };
  }

  function dispose() {
    alive = false; busy = true;
    if (S) { const s = S; S = null; try { s.dispose(); } catch (x) { /* freed */ } }
  }
  cut();
  return {
    tick, dispose,
    debug: () => ({ slug: shot && shot.slug, n, t, busy, cam: { ...cur, lookat: cur.lookat.slice() }, centre: centre.slice(), band, pose: lastPose && { ...lastPose }, plan: plan.slice(0, 12).map(s => s.slug) }),
    cut: () => cut(),
    plate: () => (shot && S ? plate() : null),
    get sim() { return S; },
    get shot() { return shot; },
  };
}

// ---- the browser hook ------------------------------------------------------------
if (hasDOM && typeof window !== 'undefined') {
  let run = null;
  const HIDE = 'body>*:not(.ac-saver-canvas){display:none!important}.ac-saver-canvas{position:fixed;inset:0;width:100vw;height:100vh;display:block;cursor:none;transition:opacity .6s ease;background:#06080d}';
  window.snSaver = {
    async enter(o = {}) {
      if (run) window.snSaver.exit();
      window.snSaverActive = true;
      try { window.dispatchEvent(new CustomEvent('sn-saver-enter')); } catch (e) { /* old browser */ }
      const st = document.createElement('style'); st.textContent = HIDE; document.head.appendChild(st);
      const canvas = document.createElement('canvas'); canvas.className = 'ac-saver-canvas'; canvas.setAttribute('aria-hidden', 'true');
      document.body.appendChild(canvas);
      const R = run = { st, canvas, view: null, sv: null, raf: 0, alive: true };
      start(R, o).catch(e => console.error('articraft saver', e));
      return { canvas, warmupMs: 3500 };
    },
    exit() {
      const R = run; if (!R) return;
      run = null; R.alive = false;
      cancelAnimationFrame(R.raf);
      if (R.onResize) window.removeEventListener('resize', R.onResize);
      try { R.sv && R.sv.dispose(); } catch (e) { /* freed */ }
      try { R.view && R.view.dispose(); } catch (e) { /* freed */ }
      R.canvas.remove(); R.st.remove();
      window.snSaverActive = false;
      try { window.dispatchEvent(new CustomEvent('sn-saver-exit')); } catch (e) { /* old browser */ }
    },
    debug: () => (run && run.sv ? run.sv.debug() : null),
  };

  async function start(R, o) {
    const here = p => new URL(p, import.meta.url).href;
    const [sim, eng, rend, THREE] = await Promise.all([
      import('./sim.js'), import('../mujoco-lab/core/engine.js'), import('../mujoco-lab/render/renderer.js'),
      globalThis.THREE ? Promise.resolve(globalThis.THREE) : import(here('../../vendor/three@0.160.0/build/three.module.js')),
    ]);
    // data/manifest.json, or the fixture while lane A has no data
    const man = await sim.loadManifest();
    const mj = await eng.loadMuJoCo();
    if (!R.alive) return;
    const phone = typeof matchMedia === 'function' && matchMedia('(max-width:768px), (pointer:coarse)').matches;
    R.view = rend.createMjRenderer(R.canvas, null, { THREE, phone, theme: 'night', interact: false, flags: { perturb: false, tendons: false } });
    R.view.resize();
    R.onResize = () => R.view && R.view.resize();
    window.addEventListener('resize', R.onResize);
    const env = {
      objects: man.objects || [], groups: man.groups || [], canvas: R.canvas, view: R.view,
      poseAt: sim.poseAt, setTargets: sim.setTargets,
      load: entry => sim.loadObject(mj, entry, { loose: false, props: [] }),
    };
    R.sv = startSaver(env, { ...o, phone });
    let last = performance.now();
    const frame = now => {
      if (!R.alive) return;
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      R.sv.tick(dt);
      if (R.sv.sim) R.view.render();
      R.raf = requestAnimationFrame(frame);
    };
    R.raf = requestAnimationFrame(frame);
  }
}
