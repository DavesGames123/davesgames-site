// ============================================================================
//  FLY DUEL  ·  node tests for the camera director  (node tests/fly3d-director.test.mjs)
// ----------------------------------------------------------------------------
//  Checks ui/fly3d/director.js and the shot poses of ui/fly3d/scene.js.
//
//    rules    reduced motion cuts, no repeats, the hold time, the lock of
//             the turn-change pause, the win cuts into the lock
//    games    the choreo steps of whole bot games through onStep: every
//             shot kind occurs, no shot follows itself, no change in a
//             pause, each lethal record gets the low shot
//    poses    a played game at speed 2: each shot keeps the camera inside
//             the hall and over the table top, and its subject in frame
//    toss     the toss step cuts to the toss shot on the loser, tick()
//             goes on to the win shot after SHOTS.toss.hold, and a think
//             step cancels that change
//  Exit code 1 on any failure.
// ============================================================================
import { registerHooks } from 'node:module';

const vendor = new URL('../../../vendor/three@0.160.0/', import.meta.url);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'three') return { url: new URL('build/three.module.js', vendor).href, shortCircuit: true };
    if (spec.startsWith('three/addons/')) return { url: new URL('examples/jsm/' + spec.slice(13), vendor).href, shortCircuit: true };
    return next(spec, ctx);
  },
});

const THREE = await import('three');
const rules = await import('../game/rules.js');
const CM = await import('../game/cards.js');
const { randomBot, greedyBot } = await import('../game/bots.js');
const { Match, agentFromBot } = await import('../ui/match.js');
const { choreograph } = await import('../ui/fly3d/choreo.js');
const { createDirector, recordInfo, SHOTS, PRIORITY } = await import('../ui/fly3d/director.js');
const { createDuelScene, TABLE } = await import('../ui/fly3d/scene.js');
const { HALL } = await import('../ui/fly3d/hall.js');

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const DECKS = CM.DECK_ORDER || ['amber', 'moss'];
function rngf(s) { let a = s >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function botMatch(seed) {
  const mk = i => ((seed + i) % 3 === 0 ? agentFromBot(randomBot(rngf(seed * 7 + i)), 'random') : agentFromBot(greedyBot(), 'greedy'));
  const n = DECKS.length;
  return new Match(rules, [mk(0), mk(1)], { seed, decks: [DECKS[seed % n], DECKS[(seed * 3 + 2) % n]] });
}

// --- rules ---------------------------------------------------------------------
{
  const r = createDirector({ reduced: true });
  let allCut = true;
  for (const [k, shot] of ['over', 'follow', 'dolly', 'crane', 'crowd', 'wide'].entries()) { r.request(shot, 0, 10 * k, { force: true }); allCut = allCut && r.state.cut; r.state.cut = false; }
  ok(allCut, 'reduced motion: every change is a cut');

  const d = createDirector();
  ok(d.request('over', 0, 1) && d.state.shot === 'over' && d.state.cut === true, 'over is a cut');
  ok(!d.request('over', 0, 5), 'the same shot again does nothing');
  ok(!d.request('wide', 0, 1.2), 'a weaker shot waits for the hold time');
  ok(d.request('dolly', 0, 1.3) && d.state.cut === false, 'a stronger shot cuts in; dolly is an eased move');
  d.request('crane', 0, 10); d.request('wide', 0, 20); d.request('crane', 0, 30);
  ok(d.state.shot === 'crane' || d.state.shot === 'wide', 'wide and crane alternate');
  const e = createDirector();
  e.request('over', 0, 0); e.request('crowd', 1, 5, { force: true }); e.request('over', 0, 10);
  ok(e.state.shot === 'close', `a weak shot in the last two changes to its ALT (${e.state.shot})`);
  const f = createDirector();
  f.onStep({ op: 'beat', to: 1, dur: 1.2 }, 50, {});
  ok(f.state.shot === 'wide', 'the pause goes wide');
  ok(!f.request('dolly', 0, 50.5, {}) && f.state.shot === 'wide', 'no cut in the pause');
  ok(f.request('win', 1, 50.6, { force: true }), 'the win cuts into the pause');
  ok(Object.values(SHOTS).every(s => s.move === 'cut' || s.move === 'ease'), 'each shot is a cut or an eased move');
}

// --- games: steps through onStep ----------------------------------------------------
{
  const used = {};
  let repeats = 0, pauseCuts = 0, lethal = 0, lethalLow = 0, n = 0;
  for (let g = 1; g <= 30; g++) {
    const M = botMatch(g), d = createDirector();
    let t = 0, r, last = d.state.shot + ':' + d.state.p;
    while ((r = M.next())) {
      const info = recordInfo(r), c = choreograph(r);
      if (info.lethal) lethal++;
      let lowSeen = false, lockEnd = -1;
      for (const s of c.steps) {
        const before = d.state.shot + ':' + d.state.p;
        d.onStep(s, t + s.at, info);
        const now = d.state.shot + ':' + d.state.p;
        if (now !== before) {
          used[d.state.shot] = (used[d.state.shot] || 0) + 1; n++;
          if (now === last) repeats++;
          if (t + s.at < lockEnd && d.state.shot !== 'win') pauseCuts++;
          last = now;
        }
        if (s.op === 'beat') lockEnd = t + s.at + s.dur;
        if (d.state.shot === 'low') lowSeen = true;
      }
      if (info.lethal && lowSeen) lethalLow++;
      t += c.total + 0.2;
    }
  }
  for (const s of ['over', 'close', 'follow', 'dolly', 'combat', 'crane', 'crowd', 'low', 'win', 'wide']) ok((used[s] || 0) > 0, `games: shot ${s} occurs (${used[s] || 0})`);
  ok(repeats === 0, `games: no shot follows itself (${repeats} of ${n})`);
  ok(pauseCuts === 0, `games: no change in a turn pause but the win (${pauseCuts})`);
  ok(lethal > 0 && lethalLow === lethal, `games: each lethal record gets the low shot (${lethalLow}/${lethal})`);
}

// --- poses: a played game ---------------------------------------------------------
{
  // At speed 2 (the director works up to speed 2.5) the scene plays a
  // game. On each frame: the camera is inside the hall and above the
  // table top. When a shot has run 0.8 s: its subject is in the frame.
  const inFrame = (cam, w, m = 0.98) => { const v = w.clone().project(cam); return Math.abs(v.x) < m && Math.abs(v.y) < m && v.z < 1; };
  for (const [w, h] of [[960, 540], [390, 760]]) {
    const sc = createDuelScene({ clientWidth: w, clientHeight: h }, { headless: true });
    await sc.ready;
    const M = botMatch(4);
    sc.setState(M.state); sc.setSpeed(2);
    const D = sc.world.dir;
    let outHall = 0, under = 0, frames = 0;
    const seen = {}, miss = {};
    let r, recs = 0;
    while ((r = M.next()) && recs++ < 400) {
      let done = false;
      sc.play(r).then(() => { done = true; });
      for (let k = 0; k < 20000 && !done; k++) {
        sc.render(1 / 30); await null; frames++;
        const c = sc.camera.position;
        if (Math.abs(c.x) > HALL.wall - 0.3 || Math.abs(c.z) > HALL.wall - 0.3 || c.y > HALL.ceiling - 0.2) outHall++;
        const overTable = Math.abs(c.x) < TABLE.halfLen && Math.abs(c.z) < TABLE.halfDepth;
        if (c.y < (overTable ? TABLE.y + 0.15 : 0.3)) under++;
        const st = D.state, age = sc.world.sceneT - st.since;
        if (age > 0.8 && age < 0.85) {
          const subj = sc.world.shotSubject();
          if (subj) { seen[st.shot] = (seen[st.shot] || 0) + 1; if (!inFrame(sc.camera, subj)) miss[st.shot] = (miss[st.shot] || 0) + 1; }
        }
      }
    }
    const tag = `${w}x${h}`;
    ok(frames > 1000, `${tag}: ${frames} frames, ${recs} records`);
    ok(outHall === 0, `${tag}: camera inside the hall (${outHall} frames out)`);
    ok(under === 0, `${tag}: camera over the table top and the floor (${under} frames under)`);
    ok(Object.keys(seen).length >= 5, `${tag}: subjects checked for ${Object.keys(seen).join(', ')}`);
    ok(Object.keys(miss).length === 0, `${tag}: each shot keeps its subject in the frame (misses ${JSON.stringify(miss)} of ${JSON.stringify(seen)})`);
    sc.dispose();
  }
}

// --- the toss shot (the loser throws its hand) ---------------------------------------------------------------------------
{
  ok(SHOTS.toss && SHOTS.toss.move === 'cut' && SHOTS.toss.hold > 2.5, 'SHOTS.toss is a cut that holds for the head-down');
  ok(PRIORITY.toss >= PRIORITY.low, 'the toss shot cuts into the lethal shot');
  const d = createDirector();
  d.onStep({ op: 'win', winner: 0 }, 10, {});
  d.onStep({ op: 'toss', p: 1, winner: 0 }, 10, {});
  ok(d.state.shot === 'toss' && d.state.p === 1 && d.state.cut, 'the toss step cuts to the toss shot on the loser');
  ok(d.tick(10 + SHOTS.toss.hold - 0.1) === false && d.state.shot === 'toss', 'the toss shot holds');
  ok(d.tick(10 + SHOTS.toss.hold + 0.01) === true && d.state.shot === 'win' && d.state.p === 0, 'then tick goes to the win shot of the winner');
  ok(d.tick(30) === false, 'tick does nothing more');
  d.onStep({ op: 'toss', p: 0, winner: 1 }, 40, {});
  d.onStep({ op: 'think', p: 1 }, 41, {});
  ok(d.tick(60) === false && d.state.then === null, 'a think step cancels the change to the win shot');
  const r = createDirector({ reduced: true });
  r.onStep({ op: 'toss', p: 0, winner: 1 }, 1, {});
  ok(r.state.shot === 'toss' && r.state.cut, 'reduced motion: the toss shot is a cut');
}

console.log(`fly3d-director: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
