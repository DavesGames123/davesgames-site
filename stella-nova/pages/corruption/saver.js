// ============================================================================
//  CORRUPTION  ·  saver.js — the screensaver shot plan and window.snSaver
// ----------------------------------------------------------------------------
//  The shell screensaver (lib/screensaver.js) calls window.snSaver.enter(opts)
//  with { calm 0..1, seconds, caption, seed }. Each shot is a new shuffle on
//  a model, with its own camera: a slow orbit, a push-in on the front, or a
//  low pass along the deck. Shots last 7 to 12 s; the model changes on most
//  cuts. Calm lowers the screen glitch and the orbit speed.
//
//  GREP MAP
//    grep -n 'export function makePlan'   seed -> shots (no DOM)
//    grep -n 'export function installSaver' the window hook (main.js passes the view)
// ============================================================================
import { rng } from './params.js';
import { MODELS } from './models.js';

export const SAVER_MODELS = MODELS.filter(m => !m.custom).map(m => m.id);
export const MOVES = ['orbit', 'push', 'low'];

export function makePlan(seed, n = 24) {
  const r = rng(seed >>> 0);
  const order = [...SAVER_MODELS];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const shots = [];
  let mi = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0 && r() < 0.75) mi = (mi + 1) % order.length;
    const move = MOVES[Math.floor(r() * MOVES.length)];
    shots.push({
      model: order[mi], move, seed: (r() * 4294967296) >>> 0,
      dur: 7 + 5 * r(), yaw: r() * Math.PI * 2, dir: r() < 0.5 ? -1 : 1,
      pitch: move === 'low' ? 0.06 + 0.06 * r() : 0.15 + 0.35 * r(),
      dist: move === 'push' ? [3.4, 2.1] : move === 'low' ? [3.0, 2.6] : [3.8, 3.4],
    });
  }
  return shots;
}

// view: { canvas, applyShot(shot, calm), tick(shot, k, calm), setSaver(on), plateShift() }
export function installSaver(view) {
  let run = null;
  window.snSaver = {
    enter(opts = {}) {
      if (run) window.snSaver.exit();
      const calm = Math.min(1, Math.max(0, opts.calm ?? 0.6));
      const plan = makePlan(opts.seed ?? (Math.random() * 4294967296) >>> 0);
      run = { plan, i: 0, t0: performance.now(), calm, raf: 0 };
      view.setSaver(true);
      view.applyShot(plan[0], calm);
      const step = () => {
        if (!run) return;
        const s = run.plan[run.i % run.plan.length];
        const k = (performance.now() - run.t0) / 1000 / s.dur;
        if (k >= 1) {
          run.i++; run.t0 = performance.now();
          view.applyShot(run.plan[run.i % run.plan.length], calm);
        } else view.tick(s, k, calm);
        run.raf = requestAnimationFrame(step);
      };
      run.raf = requestAnimationFrame(step);
      return { canvas: view.canvas, warmupMs: 1500 };
    },
    exit() {
      if (!run) return;
      cancelAnimationFrame(run.raf);
      run = null;
      view.setSaver(false);
    },
    debug() { return run ? { shot: run.i, model: run.plan[run.i % run.plan.length].model } : null; },
    cut() { if (run) { run.i++; run.t0 = performance.now(); view.applyShot(run.plan[run.i % run.plan.length], run.calm); } },
  };
}
