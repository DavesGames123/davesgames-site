// ============================================================================
//  FLIP WATER  ·  tests.mjs  —  node checks (no browser)
// ----------------------------------------------------------------------------
//  Run: node tests.mjs            (all checks; the seed sweep uses workers)
//       node tests.mjs --quick    (20 seeds instead of 200)
//
//  Checks
//    sweep        200 random seeds x 600 frames: no NaN, no particle out of
//                 the tank, particle count = initial + emitted - drained,
//                 water area from the grid within 0.6..1.6 of the particle
//                 area (no collapse, no blow-up)
//    determinism  the same seed gives the same particles after 120 frames
//    hash         encodeHash / decodeHash round-trip of random states
//    preset       the default 'harbour' scene builds and runs
//    import       main.js links in node (a SyntaxError is a bug; a
//                 ReferenceError on a browser global is expected)
//
//  grep -n targets: function sweepSeeds  function check  CHECKS.push
// ============================================================================
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import * as SC from './scenes.js';

const FRAMES = 600;
const ENV = { budget: 2400, minRes: 30, portrait: false };

function randomState(i) {
  const st = SC.defaultState();
  st.seed = 'test' + i;
  return st;
}

export function runSeed(i, frames = FRAMES) {
  const st = randomState(i);
  const spec = SC.build(st, ENV);
  const sim = SC.createSim(spec);
  const res = { i, kind: spec.waterKind, bad: [] };
  let minRatio = 9, maxRatio = 0;
  for (let f = 0; f < frames; f++) {
    sim.step();
    if (f % 100 === 99 || f === frames - 1) {
      const s = sim.stats();
      if (s.nan) res.bad.push(`frame ${f}: ${s.nan} NaN`);
      if (s.out) res.bad.push(`frame ${f}: ${s.out} particles out of the tank`);
      if (s.n !== s.initial + s.emitted - s.drained) res.bad.push(`frame ${f}: count ${s.n} != ${s.initial}+${s.emitted}-${s.drained}`);
      if (s.n > 50) {
        const ratio = s.area / s.particleArea;
        minRatio = Math.min(minRatio, ratio); maxRatio = Math.max(maxRatio, ratio);
      }
      if (res.bad.length) break;
    }
  }
  if (minRatio < 0.6 || maxRatio > 1.6) res.bad.push(`area ratio ${minRatio.toFixed(2)}..${maxRatio.toFixed(2)} outside 0.6..1.6`);
  res.minRatio = minRatio; res.maxRatio = maxRatio;
  return res;
}

if (!isMainThread) {
  const out = [];
  for (const i of workerData.seeds) out.push(runSeed(i));
  parentPort.postMessage(out);
} else {
  await main();
}

async function sweepSeeds(n) {
  const cores = Math.max(1, Math.min(8, os.cpus().length - 1));
  const buckets = Array.from({ length: cores }, () => []);
  for (let i = 0; i < n; i++) buckets[i % cores].push(i);
  const file = fileURLToPath(import.meta.url);
  const parts = await Promise.all(buckets.map(seeds => new Promise((res, rej) => {
    const w = new Worker(file, { workerData: { seeds } });
    w.on('message', res); w.on('error', rej);
  })));
  return parts.flat().sort((a, b) => a.i - b.i);
}

async function main() {
  const quick = process.argv.includes('--quick');
  let pass = 0, fail = 0;
  const check = (name, ok, info = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

  // hash round-trip
  {
    let ok = true, n = 0;
    const r = (k) => Math.abs(Math.sin(k * 12.9898) * 43758.5453) % 1;
    for (let k = 0; k < 300; k++) {
      const st = SC.defaultState();
      st.seed = SC.newSeed(() => r(k + 0.1));
      const cats = SC.CATS.concat(['objects']);
      for (const c of cats) if (r(k * 7 + c.length) < 0.3) st.sub[c] = SC.newSeed(() => r(k + c.length * 3.3));
      st.locks = cats.filter((c, j) => r(k * 3 + j) < 0.25).sort();
      for (const key of Object.keys(SC.OVERRIDES)) if (r(k * 11 + key.length) < 0.3) st.over[key] = +(r(k + key.length) * 3).toFixed(3);
      const back = SC.decodeHash(SC.encodeHash(st));
      const norm = (s) => JSON.stringify({ seed: s.seed, sub: Object.fromEntries(Object.entries(s.sub).sort()), locks: s.locks.slice().sort(), colours: Object.fromEntries(Object.entries(s.colours).map(([a, b]) => [a, String(b)]).sort()), over: Object.fromEntries(Object.entries(s.over).sort()) });
      if (norm(back) !== norm(st)) { ok = false; console.log('  mismatch', norm(st), norm(back)); break; }
      n++;
    }
    check('hash round-trip of seed, sub-seeds, locks, colours and overrides', ok, `${n} states`);
    const a = SC.decodeHash('#s=abc&lock=tank.water&tank=zzz&o.flip=0.5&o.bogus=3');
    check('hash decode keeps known keys only', a.seed === 'abc' && a.sub.tank === 'zzz' && a.locks.join() === 'tank.water'.replace('.', ',') && a.over.flip === 0.5 && !('bogus' in a.over));
  }

  // rolls and locks
  {
    const st = SC.defaultState(); st.seed = 'lockme'; st.locks = ['tank', 'gravity'];
    const s0 = SC.build(st, ENV);
    const next = SC.rollAll(st, () => 0.42);
    const s1 = SC.build(next, ENV);
    check('a locked category keeps its draws after New scene', s0.g === s1.g && s0.tilt === s1.tilt && s0.W === s1.W && s0.H === s1.H, `seed ${st.seed} -> ${next.seed}`);
    const st2 = SC.rollCat(st, 'gravity', () => 0.9);
    const s2 = SC.build(st2, ENV);
    check('rolling one category leaves the others', s2.W === s0.W && s2.flip === s0.flip && s2.waterKind === s0.waterKind);
  }

  // determinism
  {
    const st = SC.defaultState(); st.seed = 'det42';
    const run = () => { const sim = SC.createSim(SC.build(st, ENV)); for (let f = 0; f < 120; f++) sim.step(); return sim; };
    const a = run(), b = run();
    let same = a.numParticles === b.numParticles;
    for (let i = 0; same && i < 2 * a.numParticles; i++) if (a.particlePos[i] !== b.particlePos[i]) same = false;
    check('same seed, same particles after 120 frames', same, `${a.numParticles} particles`);
  }

  // default preset
  {
    const spec = SC.build(SC.defaultState(), ENV);
    const sim = SC.createSim(spec);
    for (let f = 0; f < 200; f++) sim.step();
    const s = sim.stats();
    check('default harbour scene runs (gate lifts, water moves)', !s.nan && !s.out && spec.gate && s.maxSpeed > 0.5, `${s.n} particles, max speed ${s.maxSpeed.toFixed(2)} m/s`);
  }

  // sweep
  {
    const n = quick ? 20 : 200;
    const t0 = Date.now();
    const res = await sweepSeeds(n);
    const bad = res.filter(r => r.bad.length);
    for (const r of bad.slice(0, 8)) console.log(`  seed test${r.i} (${r.kind}): ${r.bad.join('; ')}`);
    const kinds = {};
    for (const r of res) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
    const lo = Math.min(...res.map(r => r.minRatio)), hi = Math.max(...res.map(r => r.maxRatio));
    check(`${n} random seeds x ${FRAMES} frames: no NaN, no escape, count balance, area ratio`, bad.length === 0,
      `${bad.length} bad · area ratio ${lo.toFixed(2)}..${hi.toFixed(2)} · ${JSON.stringify(kinds)} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }

  // main.js link check
  {
    let msg = 'ok';
    try { await import('./main.js'); }
    catch (e) { msg = `${e.name}: ${e.message}`; }
    check('main.js links in node (no SyntaxError)', !/SyntaxError/.test(msg), msg.slice(0, 90));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
