// ============================================================================
//  FLY DUEL  ·  the training worker  (module Web Worker, no DOM)
// ----------------------------------------------------------------------------
//  Section 06 of the page (main.js, initTrain) runs this worker. It holds
//  fly A and fly B and trains them by self-play in small slices, so the
//  page stays fast and a pause takes effect between two games.
//
//  PROTOCOL (messages in)
//      { cmd: 'init', connectome, weights?: { A, B }, opts? }
//            build two flies: naive, or from saved Fly JSON (pretrained).
//      { cmd: 'train', games: n, mix? }
//            play n more training games, then post 'weights'. mix gives
//            the share of games vs the random bot, vs the greedy bot and
//            fly vs fly: { random, greedy, self } (default TRAIN_MIX of
//            train/selfplay.js).
//      { cmd: 'pause' }     stop after the current game, post 'paused'.
//      { cmd: 'eval', n }   n games each fly vs random, vs greedy, A vs B
//                           with greedy play (no exploration, no learning).
//  PROTOCOL (messages out)
//      { type: 'ready', games, trained }                  after init
//      { type: 'progress', game, winRateA, vsRandom: {A, B}, vsGreedy:
//        {A, B}, ms }  every PROGRESS_EVERY games. winRateA is the share
//        of the recent fly vs fly games that fly A won. vsRandom and
//        vsGreedy are rates over the recent training games against each
//        bot (with exploration on, so they are lower than the eval rate).
//      { type: 'weights', A, B, game }      end of each train batch
//      { type: 'eval', game, n, vsRandom: {A, B}, vsGreedy: {A, B},
//        AvsB, counts }                     measured, no learning
//      { type: 'paused', game }  { type: 'error', message }
//
//  The training step is the same as tools/train.mjs (train/selfplay.js,
//  way A TD learning), so the browser curve and the shipped curve measure
//  the same thing. The worker has no clock-based logic: given the same
//  messages it gives the same weights.
//
//  GREP MAP   (grep -n "<anchor>" train/worker.js)
//      createTrainer ... "export function createTrainer"  the protocol, no worker globals
//      TRAIN_MIX, FLY_OPTS  re-exported from train/selfplay.js
//      worker glue ..... "self.onmessage"
// ============================================================================
import { Fly, makePair } from '../brain/fly.js';
import { evaluate, trainGame, TRAIN_MIX, FLY_OPTS } from './selfplay.js';
import { mulberry32, hashSeed } from '../data/rng.js';

export { TRAIN_MIX, FLY_OPTS };
const PROGRESS_EVERY = 10;
const SLICE = 5;          // games per macrotask, so 'pause' gets in

// The protocol as a plain object, so node tests can drive it with a
// fake post(). post(msg) sends a message out. defer(fn) runs fn later
// (setTimeout in the worker; tests may run it at once or queue it).
export function createTrainer(post, defer = fn => setTimeout(fn, 0)) {
  const T = { A: null, B: null, connectome: null, game: 0, running: false, todo: 0, rng: null, mix: TRAIN_MIX, recent: null, t0: 0 };
  const resetRecent = () => { T.recent = { self: [], random: { A: [], B: [] }, greedy: { A: [], B: [] } }; };
  const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const push = (a, v, cap = 50) => { a.push(v); if (a.length > cap) a.shift(); };

  function progress() {
    const R = T.recent;
    post({
      type: 'progress', game: T.game,
      winRateA: mean(R.self),
      vsRandom: { A: mean(R.random.A), B: mean(R.random.B) },
      vsGreedy: { A: mean(R.greedy.A), B: mean(R.greedy.B) },
    });
  }

  function slice() {
    if (!T.running) return;
    const n = Math.min(SLICE, T.todo);
    for (let i = 0; i < n; i++) {
      const { kind, results } = trainGame(T.A, T.B, T.game, T.rng, { mix: T.mix });
      T.game++; T.todo--;
      if (kind === 'self') push(T.recent.self, results[0].won);
      else for (const r of results) push(T.recent[kind][r.fly], r.won);
      if (T.game % PROGRESS_EVERY === 0) progress();
    }
    if (T.todo > 0) { defer(slice); return; }
    T.running = false;
    post({ type: 'weights', game: T.game, A: T.A.toJSON(), B: T.B.toJSON() });
  }

  function handle(m) {
    try {
      if (!m || typeof m !== 'object') return;
      if (m.cmd === 'init') {
        T.connectome = m.connectome;
        if (!T.connectome) throw new Error('init needs the connectome');
        const w = m.weights || {};
        const opts = { ...FLY_OPTS, ...(m.opts || {}) };
        let [A, B] = (w.A && w.B) ? [null, null] : makePair(T.connectome, opts);
        if (w.A && w.B) { A = Fly.fromJSON(T.connectome, w.A); B = Fly.fromJSON(T.connectome, w.B); }
        T.A = A; T.B = B;
        T.game = (w.A && w.B && Number.isFinite(w.games)) ? w.games : 0;
        T.rng = mulberry32(hashSeed(`worker:${T.game}`));
        T.running = false; T.todo = 0;
        resetRecent();
        post({ type: 'ready', game: T.game, trained: !!(w.A && w.B) });
      } else if (m.cmd === 'train') {
        if (!T.A) throw new Error('train before init');
        if (m.mix) T.mix = m.mix;
        T.todo += Math.max(1, m.games | 0);
        if (!T.running) { T.running = true; defer(slice); }
      } else if (m.cmd === 'pause') {
        T.running = false; T.todo = 0;
        post({ type: 'paused', game: T.game });
      } else if (m.cmd === 'eval') {
        if (!T.A) throw new Error('eval before init');
        const n = Math.max(2, m.n | 0 || 200);
        const seed = hashSeed(`worker-eval:${T.game}`);
        const ev = {
          rA: evaluate(T.A, 'random', n, seed), rB: evaluate(T.B, 'random', n, seed),
          gA: evaluate(T.A, 'greedy', n, seed), gB: evaluate(T.B, 'greedy', n, seed),
          ab: evaluate(T.A, T.B, n, seed),
        };
        post({ type: 'eval', game: T.game, n,
          vsRandom: { A: ev.rA.rate, B: ev.rB.rate }, vsGreedy: { A: ev.gA.rate, B: ev.gB.rate }, AvsB: ev.ab.rate,
          counts: Object.fromEntries(Object.entries(ev).map(([k, e]) => [k, [e.wins, e.losses, e.draws]])) });
      }
    } catch (e) {
      T.running = false;
      post({ type: 'error', message: String(e && e.message || e) });
    }
  }
  return { handle, state: T };
}

// Worker glue. In node (tests) there is no worker scope, so this part
// does nothing on import.
if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
  const trainer = createTrainer(m => self.postMessage(m));
  self.onmessage = e => trainer.handle(e.data);
}
