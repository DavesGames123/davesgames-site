// quality.test.mjs — tests of the frame-rate governor (../quality.js) with a
// synthetic GPU load. Run: node tools/quality.test.mjs
//
// The load model: gpu ms = base * share * res^2 + 0.5. The rAF interval is
// the display period, or the gpu time when the gpu time is longer.

import assert from 'node:assert/strict';
import { createGovernor, LEVELS } from '../quality.js';

function run({ periodMs, base, seconds, load }) {
  let level = 0;
  const gov = createGovernor((l) => { level = l; });
  let now = 0;
  // The boot: one second of frames that draw nothing.
  for (; now < 1000; now += periodMs) gov.idle(periodMs);
  const trace = [];
  while (now < 1000 + seconds * 1000) {
    const q = LEVELS[level];
    const b = load ? load(now - 1000) : base;
    const gpu = b * q.share * q.res * q.res + 0.5;
    const dt = Math.max(periodMs, gpu);
    now += dt;
    gov.sample(dt, gpu, now);
    trace.push(level);
  }
  return { level, gov, trace };
}

// 1. A 4K scene that costs 12 ms on a 120 Hz display drops until it fits.
{
  const { level, gov } = run({ periodMs: 1000 / 120, base: 12, seconds: 20 });
  const q = LEVELS[level];
  const gpu = 12 * q.share * q.res * q.res + 0.5;
  assert.ok(level > 0, 'drops below level 0');
  assert.ok(gpu <= 1.1 * 1000 / 120, `fits the frame: gpu ${gpu.toFixed(2)} ms at level ${level}`);
  console.log(`ok 1  120 Hz, 12 ms scene -> level ${level}, gpu ${gpu.toFixed(2)} ms, period ${gov.stats.period.toFixed(2)}`);
}

// 2. The same scene on a 60 Hz display stays at full quality.
{
  const { level } = run({ periodMs: 1000 / 60, base: 12, seconds: 20 });
  assert.equal(level, 0);
  console.log('ok 2  60 Hz, 12 ms scene -> level 0');
}

// 3. A light scene never leaves level 0.
{
  const { trace } = run({ periodMs: 1000 / 120, base: 3, seconds: 20 });
  assert.ok(trace.every((l) => l === 0));
  console.log('ok 3  120 Hz, 3 ms scene -> level 0 throughout');
}

// 4. A heavy scene that turns light again (a switch to a small location) climbs back to level 0.
{
  const { level, trace } = run({ periodMs: 1000 / 120, seconds: 60, load: (t) => (t < 10000 ? 30 : 3) });
  assert.ok(Math.max(...trace) >= 3, 'dropped during the heavy part');
  assert.equal(level, 0);
  console.log(`ok 4  heavy then light -> lowest ${Math.max(...trace)}, end level ${level}`);
}

// 5. No oscillation: a scene near the edge settles and the level changes a few times only.
{
  const { trace } = run({ periodMs: 1000 / 120, base: 11, seconds: 120 });
  let changes = 0;
  for (let i = 1; i < trace.length; i++) if (trace[i] !== trace[i - 1]) changes++;
  assert.ok(changes <= 8, `level changes: ${changes}`);
  console.log(`ok 5  near-edge scene over 120 s -> ${changes} level changes`);
}
