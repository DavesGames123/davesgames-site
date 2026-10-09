// lab/worker.js - module worker for the CT lab. It runs one job from lab/jobs.js and
// posts its messages back. main.js ends a job by terminating the worker.
// 'play', 'pause' and 'allow' messages set the iteration allowance of a running job.
import { runJob } from './jobs.js';

const control = { allowance: Infinity };

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'play') { control.allowance = Infinity; return; }
  if (m.type === 'pause') { control.allowance = 0; return; }
  if (m.type === 'allow') { control.allowance = Math.max(0, control.allowance) + (m.k | 0); return; }
  if (m.paused) control.allowance = 0;
  runJob(m, (out) => {
    if (out.image) self.postMessage(out, [out.image.buffer]);
    else self.postMessage(out);
  }, () => false, control);
};
