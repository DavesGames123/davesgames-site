// ============================================================================
//  ARTICRAFT PLAYGROUND  ·  saver-tests.mjs — node checks of the screensaver
// ----------------------------------------------------------------------------
//  node stella-nova/pages/articraft/saver-tests.mjs
//  Plan: seeded (the same seed gives the same plan), shots of 5 to 12 s,
//  every slug is in the manifest, no object twice in a row, each bag has
//  every object, the phone plan has the small objects only.
//  Poses: poseAt from sim.js, cut by clampPose, stays in each joint range.
//  Director (stub sims): cuts at the shot length, frees the old sim, sends
//  a plate with a title, credit lines and one TeX line and no code.
//  Director (real sim.js and MuJoCo, no renderer): every object loads and
//  moves, the state stays finite, the WASM heap stops at a high-water mark.
//  Hook (stub DOM): enter() returns { canvas, warmupMs } with the canvas in
//  the document; frames run the director; exit() removes the canvas and the
//  style, frees the sim and stops the frame loop.
// ============================================================================
import { makePlan, camAt, bandFrame, clampPose, startSaver, DUR, PHONE_BYTES } from './saver.js';
import { loadManifest, loadObject, poseAt, setTargets, jointRange } from './sim.js';
import { loadMuJoCo, heapBytes } from '../mujoco-lab/core/engine.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const fin = a => Array.from(a).every(Number.isFinite);

const man = await loadManifest();
const objs = man.objects, slugs = new Set(objs.map(o => o.slug));
const jointed = objs.filter(o => o.joints && o.joints.length);
console.log(`manifest: ${man.base}manifest.json, ${objs.length} objects (${jointed.length} with joints)${man.fixture ? ' [fixture]' : ''}`);

// ---- plan ------------------------------------------------------------------------
{
  const a = makePlan(77, objs, 300), b = makePlan(77, objs, 300), c = makePlan(78, objs, 300);
  ok(JSON.stringify(a) === JSON.stringify(b), 'same seed, same plan');
  ok(jointed.length < 2 || JSON.stringify(a) !== JSON.stringify(c), 'other seed, other plan');
  for (const seed of [1, 2, 3, 99, 12345, 4e9]) {
    const p = makePlan(seed, objs, 400);
    ok(p.length === 400, `seed ${seed}: 400 shots`);
    ok(p.every(s => slugs.has(s.slug)), `seed ${seed}: every slug in the manifest`);
    ok(p.every(s => s.dur >= DUR[0] && s.dur <= DUR[1] && s.dur >= 5 && s.dur <= 12), `seed ${seed}: shots of 5 to 12 s`);
    let rep = 0; for (let i = 1; i < p.length; i++) if (p[i].slug === p[i - 1].slug) rep++;
    ok(jointed.length < 2 || rep === 0, `seed ${seed}: no object twice in a row (${rep})`);
    const k = jointed.length;
    for (let i = 0; i + k <= p.length; i += k) ok(new Set(p.slice(i, i + k).map(s => s.slug)).size === k, `seed ${seed}: bag ${i / k} has every object`);
    ok(p.every(s => Number.isFinite(s.az0 + s.el + s.period + s.phase0) && s.el < 0 && s.period > 0), `seed ${seed}: finite camera and drive values`);
  }
  const ph = makePlan(9, objs, 200, { phone: true });
  const small = jointed.filter(o => !(o.bytes > PHONE_BYTES));
  ok(small.length < 3 || ph.every(s => !(objs.find(o => o.slug === s.slug).bytes > PHONE_BYTES)), 'phone: small objects only');
  ok(makePlan(5, [], 10).length === 0, 'empty manifest: empty plan');
  const firsts = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(s => makePlan(s, objs, 1)[0].slug));
  ok(jointed.length < 3 || firsts.size >= 3, `first shot varies with the seed (${firsts.size} of 8)`);
  console.log(`plan: ${jointed.length} objects in the bag; first shot over 8 seeds: ${firsts.size} different`);
}

// ---- poses inside the joint ranges ------------------------------------------------------
{
  let n = 0, bad = 0;
  for (const s of makePlan(31, objs, Math.max(60, 3 * jointed.length))) {
    const e = objs.find(o => o.slug === s.slug);
    for (let i = 0; i < 40; i++) {
      const pose = clampPose(e, poseAt(e, (s.phase0 + i / 40) % 1));
      for (const j of e.joints) {
        if (j.type === 'ball' || j.act === null) continue;   // a mimic joint follows its source
        const v = pose[j.name], [lo, hi] = jointRange(j); n++;
        if (!(Number.isFinite(v) && v >= lo - 1e-9 && v <= hi + 1e-9)) bad++;
      }
    }
  }
  ok(n > 0 && bad === 0, `poses inside ranges: ${n - bad} of ${n}`);
  console.log(`poses: ${n} joint targets checked, ${bad} outside the range`);
}

// ---- camera and band ----------------------------------------------------------------------
{
  const sh = makePlan(3, objs, 1)[0];
  const c0 = camAt(sh, 0, [0.1, 0.2, 0.3], 0.5), c1 = camAt(sh, sh.dur, [0.1, 0.2, 0.3], 0.5);
  ok(fin([c0.azimuth, c0.elevation, c0.distance, ...c0.lookat]) && c0.lookat[2] === 0.3, 'camAt: finite, looks at the centre');
  ok(c1.distance < c0.distance && c0.elevation < 0 && c0.distance > 0.5, 'camAt: pushes in a little, looks down, outside the object');
  ok(Math.abs(c1.azimuth - c0.azimuth) > 1 && Math.abs(c1.azimuth - c0.azimuth) < 12 * 7, 'camAt: slow orbit');
  ok(camAt(sh, 5, [0, 0, 0], 0.5, 1).azimuth - sh.az0 !== camAt(sh, 5, [0, 0, 0], 0.5, 0).azimuth - sh.az0, 'camAt: calm slows the orbit');
  const bf = bandFrame(800, { t: 150, b: 250 }); ok(Math.abs(bf.k - 2) < 1e-12 && bf.dy === 50, 'bandFrame: back off h / band, centre in the band');
  ok(bandFrame(800, null).k === 1 && bandFrame(800, { t: 500, b: 500 }).k <= 2.2, 'bandFrame: no band, and the cap');
}

// ---- director with stub sims -------------------------------------------------------------
const settle = () => new Promise(r => setTimeout(r, 0));
async function idle(sv) { for (let i = 0; i < 50 && sv.debug().busy; i++) await settle(); }
{
  const made = [], targets = [];
  const stubSim = e => {
    const S = { slug: e.slug, d: { qpos: new Float64Array(4), subtree_com: new Float64Array([0, 0, 0, 0.05, 0, 0.2]) }, bodyNames: ['world', 'root'], disposed: false, steps: 0,
      advance(dt) { this.steps++; }, forward() {}, dispose() { this.disposed = true; }, totalMass: () => 1.25 };
    made.push(S); return S;
  };
  const env = { objects: objs, groups: man.groups, view: null, canvas: null, poseAt,
    setTargets: (S, v) => targets.push({ slug: S.slug, v }), load: async e => stubSim(e) };
  const plates = [];
  const sv = startSaver(env, { seed: 42, calm: 0.7, fadeMs: 0, phone: false, label: l => plates.push(l) });
  await idle(sv);
  const plan = makePlan(42, objs, 6);
  ok(sv.debug().slug === plan[0].slug, 'stub: first shot is plan[0]');
  const dt = 1 / 30;
  const cuts = [];
  for (let shot = 0; shot < 5; shot++) {
    const S0 = sv.sim, slug = sv.debug().slug; let f = 0;
    while (sv.sim === S0 && f < 30 * 14) { sv.tick(dt); f++; if (sv.debug().busy) await idle(sv); }
    cuts.push(f * dt);
    ok(S0.disposed, `stub: shot ${shot} sim freed at the cut`);
    ok(Math.abs(f * dt - plan[shot].dur) < 2 * dt, `stub: shot ${shot} (${slug}) cut at ${(f * dt).toFixed(2)} s, plan ${plan[shot].dur} s`);
    ok(sv.debug().slug === plan[shot + 1].slug, `stub: shot ${shot + 1} is plan[${shot + 1}]`);
  }
  let bad = 0;
  for (const t of targets) { const e = objs.find(o => o.slug === t.slug); for (const j of e.joints) { if (j.type === 'ball' || j.act === null || !(j.name in t.v)) continue; const [lo, hi] = jointRange(j); if (!(t.v[j.name] >= lo - 1e-9 && t.v[j.name] <= hi + 1e-9)) bad++; } }
  ok(targets.length > 100 && bad === 0, `stub: ${targets.length} target sets, ${bad} outside a range`);
  const pl = plates[0];
  ok(pl && pl.title && pl.lines.length === 2 && /CC BY 4\.0/.test(pl.lines[0]) && /Apache-2\.0/.test(pl.lines[1]), 'stub: plate title and credit lines');
  ok(pl && pl.tex.length === 1 && /\\/.test(pl.tex[0]) && !('code' in pl) && !('eq' in pl), 'stub: one TeX line, no code');
  ok(plates.length === 6, `stub: one plate for each cut (${plates.length})`);
  const before = made.filter(s => !s.disposed).length;
  sv.dispose();
  ok(before === 1 && made.every(s => s.disposed), 'stub: dispose frees the live sim');
  console.log(`stub director: cuts at ${cuts.map(c => c.toFixed(2)).join(', ')} s; plate "${pl.title}" / ${pl.sub}`);
  // a load that fails: the director goes on to the next object
  let fails = 0;
  const env2 = { ...env, load: async e => { if (fails++ === 0) throw new Error('bad object'); return stubSim(e); } };
  const ce = console.error; console.error = () => {};
  const sv2 = startSaver(env2, { seed: 42, fadeMs: 0, phone: false });
  for (let i = 0; i < 40 && (!sv2.sim || sv2.debug().busy); i++) await new Promise(r => setTimeout(r, 30));
  console.error = ce;
  ok(sv2.sim && sv2.debug().slug === plan[1].slug, 'stub: a failed load goes on to the next object');
  sv2.dispose();
}

// ---- director with the real sim.js and MuJoCo ------------------------------------------------
{
  const mj = await loadMuJoCo();
  const env = { objects: objs, groups: man.groups, view: null, canvas: null, poseAt, setTargets,
    load: e => loadObject(mj, e, { loose: false, props: [] }) };
  const heap = [], dt = 1 / 30, seen = new Map();
  let shots = 0, notFinite = 0, still = 0, slow = 0;
  const rounds = +(process.env.ROUNDS || 8), perRound = Math.min(jointed.length, 12);
  for (let round = 0; round < rounds; round++) {
    const sv = startSaver(env, { seed: 7, calm: 0.7, fadeMs: 0, phone: false });
    await idle(sv);
    for (let k = 0; k < perRound; k++) {
      const S = sv.sim, e = S && objs.find(o => o.slug === sv.debug().slug);
      if (!S) { ok(false, 'real: a sim is loaded'); break; }
      const q0 = Float64Array.from(S.d.qpos);
      let f = 0, moved = 0;
      const t0 = Date.now();
      while (sv.sim === S && f < 30 * 14) {
        sv.tick(dt); f++;
        if (sv.sim === S && !S.disposed) {
          if (!fin(S.d.qpos)) notFinite++;
          for (let i = 0; i < q0.length; i++) moved = Math.max(moved, Math.abs(S.d.qpos[i] - q0[i]));
        }
        if (sv.debug().busy) await idle(sv);
      }
      const ms = Date.now() - t0;
      if (round === 0) {
        shots++;
        if (moved < 1e-3) still++;
        if (ms > f * dt * 1000) slow++;
        seen.set(e.slug, { moved, ms, sec: f * dt, j: e.joints.length });
      }
    }
    sv.dispose();
    heap.push(heapBytes());
  }
  ok(notFinite === 0, `real: state finite (${notFinite} bad frames)`);
  ok(still === 0, `real: every object moves (${still} still of ${shots})`);
  for (const [slug, r] of seen) console.log(`  ${slug.padEnd(38)} ${r.j} joints  moved ${r.moved.toFixed(3)}  ${r.sec.toFixed(1)} s sim in ${r.ms} ms`);
  console.log(`real director: ${shots} shots, ${slow} slower than real time; WASM heap after rounds: ${heap.map(x => (x / 1048576).toFixed(1)).join(', ')} MiB`);
  // the heap grows to a high-water mark (allocator spread), then stops:
  // a leak in each shot would make it grow in the second half too
  const h = Math.floor(rounds / 2);
  ok(heap[rounds - 1] <= heap[h], `real: heap flat over the second half of the rounds (${(heap[h] / 1048576).toFixed(1)} -> ${(heap[rounds - 1] / 1048576).toFixed(1)} MiB)`);
}

// ---- hook: enter and exit with a stub DOM ---------------------------------------------------
{
  const kids = new Set(), headKids = new Set(), raf = new Map(), events = [];
  let rafId = 0;
  const mkEl = tag => ({ tag, style: {}, className: '', attrs: {}, clientWidth: 640, clientHeight: 400, textContent: '',
    setAttribute(k, v) { this.attrs[k] = v; }, remove() { kids.delete(this); headKids.delete(this); }, addEventListener() {}, removeEventListener() {} });
  const doc = { createElement: mkEl, head: { appendChild: e => { headKids.add(e); return e; } }, body: { appendChild: e => { kids.add(e); return e; } }, getElementById: () => null };
  const win = { addEventListener: (t) => events.push('+' + t), removeEventListener: (t) => events.push('-' + t), dispatchEvent: e => events.push(e.type) };
  win.parent = win;
  globalThis.window = win; globalThis.document = doc;
  globalThis.CustomEvent = class { constructor(t) { this.type = t; } };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = cb => { raf.set(++rafId, cb); return rafId; };
  globalThis.cancelAnimationFrame = id => raf.delete(id);
  globalThis.innerWidth = 640; globalThis.innerHeight = 400;
  await import('./saver.js?hook');
  ok(win.snSaver && typeof win.snSaver.enter === 'function' && typeof win.snSaver.exit === 'function', 'hook: window.snSaver has enter and exit');
  const plates = [];
  const res = await win.snSaver.enter({ calm: 0.7, seconds: 60, caption: true, seed: 5, label: l => plates.push(l) });
  ok(res && res.canvas && kids.has(res.canvas) && res.warmupMs > 0, 'hook: enter returns { canvas, warmupMs }, canvas in the document');
  ok(win.snSaverActive === true && headKids.size === 1 && events.includes('sn-saver-enter'), 'hook: GUI hidden by a style, snSaverActive set');
  let now = 0, frames = 0;
  for (let i = 0; i < 400 && plates.length < 1; i++) {
    await new Promise(r => setTimeout(r, 5));
    for (const [id, cb] of [...raf]) { raf.delete(id); now += 33; cb(now); frames++; }
  }
  const dbg = win.snSaver.debug();
  ok(dbg && slugs.has(dbg.slug) && plates.length >= 1, `hook: frames run the director (${frames} frames, shot ${dbg && dbg.slug})`);
  for (let i = 0; i < 30; i++) for (const [id, cb] of [...raf]) { raf.delete(id); now += 33; cb(now); frames++; }
  ok(win.snSaver.debug().t > 0.5, 'hook: shot time moves');
  win.snSaver.exit();
  const left = raf.size;
  for (const [id, cb] of [...raf]) { raf.delete(id); cb(now += 33); }
  ok(!kids.has(res.canvas) && headKids.size === 0 && win.snSaverActive === false && events.includes('sn-saver-exit'), 'hook: exit removes the canvas and the style');
  ok(raf.size === 0 && left <= 1 && win.snSaver.debug() === null, 'hook: exit stops the frame loop');
  ok(events.includes('+resize') && events.includes('-resize'), 'hook: resize listener added and removed');
  console.log(`hook: ${frames} stub frames, plate "${plates[0] && plates[0].title}", exit clean`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
