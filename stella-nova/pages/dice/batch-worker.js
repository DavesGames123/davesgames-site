// ============================================================================
//  DICE LAB  ·  batch-worker.js — many physics throws, headless, in a worker
// ----------------------------------------------------------------------------
//  The batch mode is the real simulation, not a random-number stand-in:
//  each throw runs physics.js simulateThrow (Rapier, the same hulls, the
//  same tray and the same rest test as the page) as fast as the worker can
//  step it, with no rendering. A cocked die is thrown again on its own,
//  as a player would. An exploding die that shows its top value adds a
//  new die, thrown on its own.
//
//  Messages in:
//    { cmd: 'start', id, spec, plan, throws, seed, tray, strength }
//    { cmd: 'stop' }
//  A start during a run stops that run and then starts. Every message out
//  carries the id of its run, so the page drops the messages of a run it
//  has replaced.
//  Messages out (every ~150 ms and at the end):
//    { kind: 'progress', done, throws, faces: { type: { label: n } },
//      totals: { total: n }, cocked, rerolls, ms, dps (dice per second) }
//    { kind: 'done' | 'stopped', id }
//    { kind: 'error', id, message }
//
//  GREP MAP
//    function oneThrow ... a throw of the plan, re-throws, explosions
//    onmessage ........... start, stop
// ============================================================================
import { createPhysics, simulateThrow } from './physics.js';
import { score, topValue } from './notation.js';

let R = null, P = null, stop = false, running = false, pending = null;

async function init(tray) {
  if (!R) {
    const M = await import('../../vendor/rapier3d-compat@0.21.0/rapier.mjs');
    R = M.default; await R.init({});
  }
  if (!P) P = createPhysics(R, { tray });
  else P.setTray(tray);
}

// one throw of a plan; returns items for score() plus face reads by type
function oneThrow(spec, plan, seed, strength, faces, counters) {
  const types = plan.map(p => p.type);
  let s = seed;
  const r = simulateThrow(P, types, { seed: s, strength });
  const items = plan.map((p, i) => ({ ...p, read: r.reads[i] }));
  // re-throw each cocked die alone until it reads
  for (const it of items) {
    let tries = 0;
    while (it.read.cocked && tries++ < 6) { counters.rerolls++; it.read = simulateThrow(P, [it.type], { seed: ++s * 7919 + tries, strength: 0.35 }).reads[0]; }
    if (it.read.cocked) counters.cocked++;
  }
  // explosions: a die at its top value adds one more die, and so on
  for (const it of items) {
    const t = spec.terms[it.term];
    if (!t.explode) continue;
    it.chain = [];
    let last = it.read, n = 0;
    const top = topValue(t.sides);
    const val = rd => t.sides === 10 && rd.value === 0 ? 10 : rd.value;
    while (val(last) === top && n++ < 20) {
      let rd = simulateThrow(P, [it.type], { seed: ++s * 104729, strength: 0.35 }).reads[0], k = 0;
      while (rd.cocked && k++ < 6) rd = simulateThrow(P, [it.type], { seed: ++s * 104729 + k, strength: 0.35 }).reads[0];
      it.chain.push(rd); last = rd;
      (faces[it.type] ||= {})[rd.label] = (faces[it.type][rd.label] || 0) + 1;
    }
  }
  for (const it of items) if (!it.read.cocked) (faces[it.type] ||= {})[it.read.label] = (faces[it.type][it.read.label] || 0) + 1;
  return score(spec, items).total;
}

self.onmessage = e => {
  const m = e.data;
  if (m.cmd === 'stop') { stop = true; pending = null; return; }
  if (m.cmd !== 'start') return;
  // a start while a run goes on: stop that run, then start this one
  if (running) { stop = true; pending = m; return; }
  run(m);
};
async function run(m) {
  running = true; stop = false;
  const id = m.id;
  try {
    await init(m.tray || 'medium');
    const faces = {}, totals = {}, counters = { cocked: 0, rerolls: 0 };
    const t0 = performance.now(); let last = t0, dice = 0;
    for (let k = 0; k < m.throws && !stop; k++) {
      const tot = oneThrow(m.spec, m.plan, (m.seed + Math.imul(k, 2246822519) + 3266489917) >>> 0, m.strength ?? 0.5, faces, counters);
      totals[tot] = (totals[tot] || 0) + 1;
      dice += m.plan.length;
      const now = performance.now();
      if (now - last > 150 || k === m.throws - 1) {
        last = now;
        self.postMessage({ kind: 'progress', id, done: k + 1, throws: m.throws, faces, totals, ...counters, ms: now - t0, dps: dice / ((now - t0) / 1000) });
        // let a stop message in
        await new Promise(r => setTimeout(r, 0));
      }
    }
    self.postMessage({ kind: stop ? 'stopped' : 'done', id });
  } catch (err) {
    self.postMessage({ kind: 'error', id, message: String(err && err.message || err) });
  } finally {
    running = false;
    if (pending) { const p = pending; pending = null; run(p); }
  }
}
