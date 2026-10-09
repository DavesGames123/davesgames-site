// lab/jobs.js - long reconstruction jobs for the CT lab: iterative solvers and the
// compare strip. lab/worker.js runs them in a Web Worker; main.js runs them on the
// main thread when a module worker cannot start. No DOM.
//
// Messages in:
//   { type: 'iter', id, method, sino, geom, dims, truth, iterations, relax, tv }
//   { type: 'compare', id, tasks: [{ label, kind: 'fbp'|'iter', filter, cutoff, method, iterations, tv }],
//     sino, geom, dims, truth }
//   { type: 'allow', k } / { type: 'play' } / { type: 'pause' }  (worker.js: iteration allowance)
// Messages out (post):
//   { type: 'iter', id, iter, iters, residual, psnr, image }   one per iteration
//   { type: 'tile', id, index, label, psnr, ssim, image }      one per compare task
//   { type: 'done', id, psnr, ssim }                          after the last one
//   { type: 'error', id, message }
//
// grep handles: runJob, solverOptions, tick

import { createSolver, fbp, psnr, ssim } from '../engine/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function solverOptions(method, relax, tv) {
  const o = {};
  if (relax > 0) o.relax = relax;
  if (tv > 0) o.tv = { weight: tv, steps: 4 };
  if (method === 'cgls') delete o.tv;            // CGLS has no projection step to add TV to
  return o;
}

// cancelled() -> true stops the job between iterations.
// control.allowance: iterations the job may still run (Infinity = free running). An 'iter'
// job waits while it is 0, so the page can pause and step the solver.
export async function runJob(msg, post, cancelled = () => false, control = { allowance: Infinity }) {
  const { id } = msg;
  try {
    if (msg.type === 'iter') {
      const s = createSolver(msg.method, msg.sino, msg.geom, msg.dims, solverOptions(msg.method, msg.relax, msg.tv));
      let r = null;
      for (let k = 0; k < msg.iterations; k++) {
        while (control.allowance <= 0) { if (cancelled()) return; await sleep(25); }
        if (cancelled()) return;
        control.allowance--;
        r = s.step();
        post({ type: 'iter', id, iter: r.iter, iters: msg.iterations, residual: r.residual,
          psnr: msg.truth ? psnr(msg.truth, r.image) : 0, image: Float32Array.from(r.image.data) });
        await tick();
      }
      const fin = r ? r.image : s.image;
      post({ type: 'done', id, psnr: msg.truth ? psnr(msg.truth, fin) : 0, ssim: msg.truth ? ssim(msg.truth, fin) : 0 });
      return;
    }
    if (msg.type === 'compare') {
      for (let t = 0; t < msg.tasks.length; t++) {
        if (cancelled()) return;
        const task = msg.tasks[t];
        let img;
        if (task.kind === 'fbp') img = fbp(msg.sino, msg.geom, msg.dims, { filter: task.filter, cutoff: task.cutoff ?? 1 });
        else {
          const s = createSolver(task.method, msg.sino, msg.geom, msg.dims, solverOptions(task.method, task.relax, task.tv));
          for (let k = 0; k < task.iterations; k++) {
            s.step();
            if (k % 8 === 7) { await tick(); if (cancelled()) return; }
          }
          img = s.image;
        }
        post({ type: 'tile', id, index: t, label: task.label, psnr: psnr(msg.truth, img), ssim: ssim(msg.truth, img),
          image: Float32Array.from(img.data) });
        await tick();
      }
      post({ type: 'done', id });
      return;
    }
    post({ type: 'error', id, message: 'unknown job ' + msg.type });
  } catch (e) {
    post({ type: 'error', id, message: String(e && e.message || e) });
  }
}

// The compare strip tasks for a preset's compare mode.
export function compareTasks(mode, params) {
  if (mode === 'filters') {
    return ['ram-lak', 'shepp-logan', 'cosine', 'hamming', 'hann'].map((f) => ({
      label: { 'ram-lak': 'Ram-Lak', 'shepp-logan': 'Shepp-Logan', cosine: 'Cosine', hamming: 'Hamming', hann: 'Hann' }[f],
      kind: 'fbp', filter: f, cutoff: params.cutoff,
    }));
  }
  if (mode === 'algorithms') {
    return [
      { label: 'FBP', kind: 'fbp', filter: 'ram-lak', cutoff: 1 },
      { label: 'SIRT x150', kind: 'iter', method: 'sirt', iterations: 150 },
      { label: 'CGLS x20', kind: 'iter', method: 'cgls', iterations: 20 },
      { label: 'SART+TV x30', kind: 'iter', method: 'sart', iterations: 30, tv: 0.02 },
    ];
  }
  return [];
}
