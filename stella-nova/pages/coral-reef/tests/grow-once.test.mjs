// ============================================================================
//  CORAL REEF  ·  corals grow once (node + jsdom, no browser)
//                 node tests/grow-once.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-17): "corals should not grow more than once".
//    worker .... mesh-worker.js: the first 'single' parks the main reef;
//                'restore' gives it back with the same particles and old
//                births (no grow-in), a full colony stays full; with no
//                parked reef 'restore' is a 'reset'
//    saver ..... main.js in jsdom (page-harness.mjs): the first dive sends
//                ONE 'single'; the later dives keep that colony (no second
//                'single', the same worker gen, the count goes on)
//    exit ...... the main reef comes back at once, already grown, with
//                old births (no grow-in replay); the corals show in one
//                frame when every coarse brick is out (no brick-by-brick)
//  Without jsdom the page part skips; the worker part always runs.
// ============================================================================
import { createRock } from '../rock/index.js';
import { createReefRunner } from '../mesh-worker.js';
import { createReefMirror } from '../reef.js';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) { pass++; console.log(`ok   ${name}${info !== '' ? '  ' + info : ''}`); } else { fail++; console.log(`FAIL ${name} ${info}`); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const wait = async (f, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await sleep(20); } return !!f(); };

// ── worker ──────────────────────────────────────────────────────────────────
{
  const rock = createRock({ seed: 3, radius: 30, quality: 'low' });
  const msgs = [];
  const mirror = createReefMirror();
  let gen = -1;
  const run = createReefRunner({
    post(m) {
      msgs.push(m);
      if (m.gen !== undefined && m.gen !== gen) { gen = m.gen; mirror.reset(); }
      if (m.type === 'colonies') mirror.setColonies(m.list);
      if (m.type === 'particles') mirror.addParticles(m.from, m.data);
    },
    makeRock: () => rock,
  });
  await run.onMessage({ type: 'init', seed: 4, quality: 'phone', radius: 30, sites: rock.sampleSurface(30 * 24, null), budget: { particles: 6000, colonies: 6, tris: 300000 } });
  await run.onMessage({ type: 'view', points: [[0, 2, 0]] });
  await wait(() => run.reef.done() || run.reef.count >= 3000, 60000);
  await run.onMessage({ type: 'play', on: false });
  await sleep(50);
  const main = run.reef, n0 = main.count, cols0 = main.colonies.length;
  const full0 = main.colonies.filter(c => c.full || c.count >= c.cap).map(c => c.k);
  let bMax = -Infinity; for (let g = 0; g < n0; g++) bMax = Math.max(bMax, main.birth[g]);
  const birth0 = Array.from(main.birth.subarray(0, n0));
  await run.onMessage({ type: 'play', on: true });
  await run.onMessage({ type: 'single', site: rock.sampleSurface(1, null)[0], species: 'staghorn', rate: 300 });
  ok(run.parked === main && run.reef !== main && run.reef.colonies.length === 1, 'worker: the first single parks the main reef and grows the colony in a reef of its own', `${n0} particles parked`);
  ok(main.count === n0 && main.colonies.length === cols0, 'worker: the parked reef keeps its particles and colonies');
  await wait(() => run.reef.count > 40, 20000);
  const saverReef = run.reef;
  await run.onMessage({ type: 'single', site: rock.sampleSurface(1, null)[0], species: 'fan', rate: 300 });
  ok(run.parked === main && run.reef === saverReef, 'worker: a second single starts the saver reef again; the main reef stays parked');
  await sleep(300);
  const g0 = run.gen, m0 = msgs.length;
  await run.onMessage({ type: 'restore', seed: 4 });
  const after = msgs.slice(m0);
  const parts = after.filter(m => m.type === 'particles' && m.gen === g0 + 1);
  const covered = parts.reduce((a, m) => a + m.data.length / 8, 0);
  ok(run.reef === main && !run.parked && run.gen === g0 + 1, 'worker: restore gives the main reef back (gen + 1)');
  ok(covered === n0 && mirror.count === n0 && mirror.colonies.filter(Boolean).length === cols0, 'worker: restore posts every particle and colony at once, before the first tick', `${covered} of ${n0} particles`);
  let same = true; for (let g = 0; g < n0; g++) if (mirror.birth[g] !== birth0[g]) { same = false; break; }
  ok(same && Math.max(...Array.from(mirror.birth.subarray(0, n0))) === bMax, 'worker: the births are the old ones (the page shows no grow-in)');
  ok(full0.every(k => main.colonies[k].full || main.colonies[k].count >= main.colonies[k].cap), 'worker: a colony at its cap stays full', `${full0.length} full colonies`);
  ok(!after.some(m => m.type === 'colonies' && m.list.some(c => c.count === 0 && c.k < cols0)), 'worker: no colony starts again from its seed');
  await wait(() => msgs.slice(m0).some(m => m.type === 'bricks' && m.list.some(b => b.lod === 1 && b.indices.length)), 20000);
  ok(msgs.slice(m0).some(m => m.type === 'bricks' && m.gen === g0 + 1), 'worker: the restored reef is meshed again');
  await run.onMessage({ type: 'play', on: false });
  // no parked reef: restore is a reset
  const g1 = run.gen;
  await run.onMessage({ type: 'restore', seed: 4 });
  ok(run.gen === g1 + 1 && run.reef.count < n0, 'worker: restore with no parked reef is a reset', `${run.reef.count} particles`);
  await run.onMessage({ type: 'play', on: false });
}

// ── page ────────────────────────────────────────────────────────────────────
const { bootPage, loadJsdom } = await import('./page-harness.mjs');
if (!loadJsdom()) console.log('grow-once: jsdom not found (set JSDOM_DIR or NODE_PATH), the page part skipped');
else {
  const P = await bootPage({ w: 1280, h: 720, dpr: 1, search: '?profile=laptop-low' });
  const W = P.win;
  const dbg = () => W.__coralDebug(), sv = () => W.snSaver.debug();
  const until = async (f, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await P.run(100); } return !!f(); };
  await until(() => dbg().worldReady && dbg().coral && dbg().coral.ready && dbg().coral.count > 600, 120000);
  await P.run(2000);
  const c0 = dbg().coral;
  ok(c0 && c0.count > 600 && c0.mainReal, 'page: the main reef grows', c0 ? `${c0.count} particles, ${c0.colonies} colonies` : '');
  W.snSaver.enter({ seed: 7, calm: 0.7, label: () => {} });
  const n0 = dbg().coral.count, cols0 = dbg().coral.colonies;
  const started = await until(() => { const d = sv(); return d.dive && d.colony && d.colony.count > 5; }, 60000);
  const d1 = sv(), gen1 = dbg().coral.gen;
  ok(started && d1.singles === 1, 'page: the first dive sends one single', JSON.stringify({ singles: d1.singles, colony: d1.colony }));
  await P.run(1500);
  const cnt1 = sv().colony ? sv().colony.count : 0;
  if (W.snSaver.skip) W.snSaver.skip();
  await P.run(1400);
  if (W.snSaver.skip) W.snSaver.skip();
  await P.run(1400);
  const d3 = sv();
  ok(d3.dive && d3.dive.i === 2 && d3.singles === 1 && dbg().coral.gen === gen1, 'page: two more dives send no second single (the same worker gen)', JSON.stringify({ i: d3.dive && d3.dive.i, singles: d3.singles, gen: dbg().coral.gen, gen1 }));
  ok(d3.colony && d3.colony.count >= cnt1 && d3.species === d1.species, 'page: the later dives keep the colony (its count goes on, the same species)', JSON.stringify({ before: cnt1, after: d3.colony && d3.colony.count, sp: d3.species }));
  const tExit = Date.now();
  W.snSaver.exit();
  await P.run(300);
  const c1 = dbg().coral;
  ok(c1.count >= n0 && c1.colonies === cols0, 'page: at the exit the main reef comes back at once, already grown', `${c1.count} particles (${n0} at enter), ${c1.colonies} colonies (${cols0}) in ${Date.now() - tExit} ms`);
  ok(c1.gen === gen1 + 1 && !c1.parked, 'page: the exit is one restore (gen + 1), not a reset');
  // the restored reef is not built brick by brick in view: the corals show
  // in one frame when the worker says that every coarse brick is out
  const hid = dbg().coralShown === false || dbg().coral.restoring === false;
  const shown = await until(() => dbg().coralShown && !dbg().coral.restoring, 30000);
  ok(hid && shown, 'page: the restored reef shows at once when its coarse mesh is all there (the coarse event)', `shown ${Date.now() - tExit} ms after the exit`);
  // the particles of the reef before the saver: old; only new growth is young
  const age = dbg().youngest ? dbg().youngest(n0) : null;
  ok(age !== null && age > 2, 'page: the restored particles keep their old births (no grow-in replay)', `the youngest of the first ${n0}: ${age && age.toFixed(1)} s`);
  ok(P.errors.length === 0, 'page: no errors', P.errors.slice(0, 2).join(' | '));
  P.close();
}
console.log(`grow-once: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
