// ============================================================================
//  BIOME PARTS  ·  director.js — the live screensaver, without the DOM
// ----------------------------------------------------------------------------
//  PURE. The saver runs Taiga-S1 live: every part is a fresh goal from the
//  seeded sampler (goals.sampleLiveGoal, levels 1 to 6, so up to 11 items,
//  twice the longest training goal), and every step is a real forward pass.
//  This module decides WHAT happens and WHEN; saver.js turns it into camera
//  springs and the plate. The node soak test (tests.mjs) runs it with a
//  synchronous Runner and an instant sleep.
//
//  PACING. A step is: think (the bars appear), a hold of 0.4 to 1.2 s (the
//  calm setting stretches it), act. Key moments hold longer: a feature that
//  makes geometry, an undo, a random command, Done.
//  GREMLIN BUILDS. About one part in three runs with a gremlin: on 12% of
//  the steps a random valid command replaces Taiga's choice (the repo's
//  --perturb test, 20% there). The plate says so, and the recovery shows.
//  SHOTS. A cut every 6 to 12 s; the next shot is never the same kind as the
//  last. The finish holds an exploded view or a gallery orbit.
//  TALLY. Every build counts, success or not; nothing is retried or hidden.
//
//  GREP MAP
//    SHOTS ............ camera shot kinds (saver.js frames them)
//    partName ......... a plain name for a goal
//    beatFor .......... the hold after a decision
//    createDirector ... run / stop / tally
// ============================================================================
import { sampleLiveGoal, rng as mkRng } from './goals.js';

export const SHOTS = ['overview', 'pushin', 'low', 'top', 'side', 'orbit'];
const KEY = /^(PartDesign_(Pad|Pocket|Hole|Revolution|Groove|Fillet|Chamfer|Thickness|Draft|Mirrored|LinearPattern|PolarPattern|Body)|Std_Undo|Done)$/;

export function partName(goal) {
  const k = goal.features.map(f => f.kind);
  const base = { base_box: 'plate', base_cyl: 'disc', base_hex: 'hex block', base_ring: 'ring' }[k[0]] || 'part';
  const bits = [];
  if (k.includes('polar_pattern')) bits.push('bolt circle');
  else if (k.includes('linear_pattern')) bits.push('hole row');
  if (k.includes('mirror')) bits.push('mirrored');
  if (k.includes('shell')) bits.push('shelled');
  if (k.some(x => x.startsWith('boss'))) bits.push('bossed');
  if (k.includes('pocket_rect')) bits.push('pocketed');
  const adj = bits.slice(0, 2).join(', ');
  return (adj ? adj + ' ' : '') + base;
}
export function beatFor(action, calm, noise) {
  const base = 0.4 + 0.8 * calm;                        // 0.4 .. 1.2 s
  return (KEY.test(action) || noise ? base * 1.8 : base) * 1000;
}

// brain: { start, think, act } (sync or async). hooks: onView(view, phase,
// extra), onShot(kind, info), onBuild(summary). sleep(ms) resolves after ms.
export function createDirector({ brain, seed = 1, calm = 0.6, sleep, hooks = {}, levels = [1, 2, 3, 3, 4, 5, 6], gremlinRate = 0.33, noiseRate = 0.12, shotMs = [6000, 12000] }) {
  const g = mkRng(seed), r = g.random;
  const tally = { built: 0, ok: 0, fail: 0, clean: { n: 0, ok: 0 }, gremlin: { n: 0, ok: 0 }, noise: 0, undos: 0, steps: 0, outcomes: {} };
  let stopped = false, lastShot = null, shotLeft = 0, n = 0;
  const call = (f, ...a) => (f ? f(...a) : undefined);
  const nextShot = info => {
    let k;
    do { k = SHOTS[Math.floor(r() * SHOTS.length)]; } while (k === lastShot);
    lastShot = k; shotLeft = shotMs[0] + r() * (shotMs[1] - shotMs[0]);
    call(hooks.onShot, k, info);
  };
  async function oneBuild() {
    const level = levels[Math.floor(r() * levels.length)];
    const goal = sampleLiveGoal(level, g);
    const gremlin = r() < gremlinRate;
    const name = partName(goal);
    n++;
    let v = await brain.start({ goal, start: { doc_open: true, workbench: 'PartDesignWorkbench', body: false } });
    const info = { n, name, level, gremlin, items: goal.features.length };
    call(hooks.onView, v, 'start', info);
    nextShot(info);
    while (!v.finished && !stopped) {
      v = await brain.think();
      call(hooks.onView, v, 'think', info);
      const d = v.decision;
      if (!d) break;
      const noise = gremlin && v.step > 3 && r() < noiseRate;
      let action = d.choice;
      if (noise) { const pool = d.rows.filter(x => x.a !== 'Done'); action = pool[Math.floor(r() * pool.length)].a; }
      const hold = beatFor(action, calm, noise);
      await sleep(hold);
      if (stopped) break;
      v = await brain.act({ action, kind: noise ? 'noise' : 'model' });
      tally.steps++;
      if (noise) tally.noise++;
      if (action === 'Std_Undo' && !noise) tally.undos++;
      call(hooks.onView, v, 'act', { ...info, action, noise });
      shotLeft -= hold + 120;
      if (shotLeft <= 0) nextShot(info);
      await sleep(120);
    }
    if (stopped) return;
    const res = v.result || { success: false, outcome: v.outcome || 'stopped' };
    tally.built++;
    tally[res.success ? 'ok' : 'fail']++;
    const bucket = gremlin ? tally.gremlin : tally.clean;
    bucket.n++; bucket.ok += +res.success;
    tally.outcomes[res.outcome] = (tally.outcomes[res.outcome] || 0) + 1;
    call(hooks.onBuild, { ...info, result: res, tally });
    // the finish: an exploded view or a gallery orbit
    const fin = r() < 0.5 ? 'exploded' : 'gallery';
    lastShot = fin;
    call(hooks.onShot, fin, { ...info, result: res });
    await sleep((4 + 3 * calm) * 1000);
  }
  return {
    tally,
    async run(maxBuilds = Infinity) { stopped = false; while (!stopped && tally.built < maxBuilds) await oneBuild(); return tally; },
    stop() { stopped = true; },
    get stopped() { return stopped; },
  };
}
