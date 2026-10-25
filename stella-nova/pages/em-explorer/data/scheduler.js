// Request scheduler for the em-explorer DATA package.
//
// run(key, job, { signal, priority, group, centre }) returns a promise.
// Calls with the same key share one task (one fetch). A task waits in
// the queue until a slot is free (maxInFlight, default 8). The queue
// gives the next slot to the task with the lowest priority number. A
// task with no priority uses its distance (nm) from the group focus.
// When the signal of a caller aborts, that caller gets an AbortError.
// When no caller waits any more, the task leaves the queue, or its own
// AbortController aborts the running job.

export function abortError() {
  try { return new DOMException('Aborted', 'AbortError'); } catch (e) {
    const err = new Error('Aborted'); err.name = 'AbortError'; return err;
  }
}

export class Scheduler {
  constructor({ maxInFlight = 8 } = {}) {
    this.maxInFlight = maxInFlight;
    this.tasks = new Map();
    this.queue = new Set();
    this.running = 0;
    this.focus = new Map();
  }
  setFocus(group, centre) { this.focus.set(group, centre); }
  get queued() { return this.queue.size; }

  run(key, job, opts = {}) {
    const { signal } = opts;
    if (signal && signal.aborted) return Promise.reject(abortError());
    let task = this.tasks.get(key);
    if (!task) {
      task = { key, job, waiters: new Set(), state: 'queued', ctrl: null,
        group: opts.group, centre: opts.centre };
      this.tasks.set(key, task);
      this.queue.add(task);
    }
    return new Promise((resolve, reject) => {
      const w = { resolve, reject, priority: opts.priority, signal, onAbort: null };
      if (signal) {
        w.onAbort = () => this.dropWaiter(task, w);
        signal.addEventListener('abort', w.onAbort, { once: true });
      }
      task.waiters.add(w);
      this.pump();
    });
  }

  dropWaiter(task, w) {
    if (!task.waiters.delete(w)) return;
    w.reject(abortError());
    if (task.waiters.size) return;
    if (task.state === 'queued') {
      this.queue.delete(task);
      this.tasks.delete(task.key);
    } else if (task.state === 'running' && task.ctrl) {
      task.ctrl.abort();
    }
  }

  cancelAll(group) {
    for (const task of [...this.tasks.values()]) {
      if (group !== undefined && task.group !== group) continue;
      for (const w of [...task.waiters]) this.dropWaiter(task, w);
    }
  }

  score(task) {
    let best = Infinity;
    for (const w of task.waiters) if (w.priority != null && w.priority < best) best = w.priority;
    if (best !== Infinity) return best;
    const f = this.focus.get(task.group);
    if (f && task.centre) {
      const dx = task.centre[0] - f.x, dy = task.centre[1] - f.y, dz = task.centre[2] - f.z;
      return 1e6 + Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return 1e15;
  }

  pump() {
    while (this.running < this.maxInFlight && this.queue.size) {
      let best = null, bestScore = Infinity;
      for (const t of this.queue) {
        const s = this.score(t);
        if (best === null || s < bestScore) { best = t; bestScore = s; }
      }
      this.queue.delete(best);
      this.start(best);
    }
  }

  start(task) {
    task.state = 'running';
    task.ctrl = new AbortController();
    this.running++;
    let p;
    try { p = Promise.resolve(task.job(task.ctrl.signal)); } catch (e) { p = Promise.reject(e); }
    p.then((value) => this.finish(task, null, value), (err) => this.finish(task, err));
  }

  finish(task, err, value) {
    task.state = 'done';
    this.running--;
    if (this.tasks.get(task.key) === task) this.tasks.delete(task.key);
    for (const w of task.waiters) {
      if (w.signal && w.onAbort) w.signal.removeEventListener('abort', w.onAbort);
      if (err) w.reject(err); else w.resolve(value);
    }
    task.waiters.clear();
    this.pump();
  }
}
