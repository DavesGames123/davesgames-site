// ============================================================================
//  DEVICE TESTS  ·  quality default, frame cache size, download advice
// ----------------------------------------------------------------------------
//  Run:  node --test stella-nova/pages/manim-live/tests/device.test.mjs
//  Covers: ui/device.js (pure), and that the quality names and sizes are
//  the same in py/manimlive/runtime.py, main.js, engine.js and the
//  #quality options of index.html. The 640x360 render itself is in
//  tests/engine.test.mjs (it needs Pyodide).
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOWNLOAD_MB, deviceProfile, defaultQuality, frameBudgetMB, networkAdvice } from '../ui/device.js';

const PAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(PAGE, f), 'utf8');

test('device: a phone or a low-memory device gets the phone quality', () => {
  const desk = deviceProfile({ deviceMemory: 8, hardwareConcurrency: 12 });
  assert.equal(defaultQuality(desk), 'low');
  assert.equal(defaultQuality(deviceProfile({ hardwareConcurrency: 6, phone: true, coarse: true })), 'phone'); // iPhone: no deviceMemory
  assert.equal(defaultQuality(deviceProfile({ deviceMemory: 4, hardwareConcurrency: 8 })), 'phone');
  assert.equal(defaultQuality(deviceProfile({ deviceMemory: 8, hardwareConcurrency: 4, coarse: true })), 'phone');
  assert.equal(defaultQuality(deviceProfile({ hardwareConcurrency: 4 })), 'low'); // a 4-core laptop
  assert.equal(defaultQuality(deviceProfile({})), 'low');
  assert.equal(defaultQuality(null), 'low');
});

test('device: frame cache budget is smaller on phones', () => {
  assert.equal(frameBudgetMB(deviceProfile({ deviceMemory: 8 })), 700);
  assert.equal(frameBudgetMB(deviceProfile({ phone: true })), 256);
  assert.equal(frameBudgetMB(deviceProfile({ deviceMemory: 2, phone: true })), 128);
  assert.equal(frameBudgetMB(null), 700);
});

test('device: download advice from the Network Information API', () => {
  assert.equal(networkAdvice(null).level, 'none');                       // iOS Safari: no API
  assert.equal(networkAdvice({ type: 'wifi', effectiveType: '4g' }).level, 'none');
  const cell = networkAdvice({ type: 'cellular', effectiveType: '4g' });
  assert.equal(cell.level, 'warn');
  assert.match(cell.text, new RegExp(`${DOWNLOAD_MB} MB`));
  assert.equal(networkAdvice({ effectiveType: '3g' }).level, 'warn');
  assert.equal(networkAdvice({ effectiveType: 'slow-2g' }).level, 'warn');
  const save = networkAdvice({ saveData: true, type: 'wifi' });
  assert.equal(save.level, 'ask');
  assert.match(save.text, /Load Python/);
});

test('device: the quality table is the same in Python, main.js, engine.js and the page', () => {
  const py = {};
  for (const m of read('py/manimlive/runtime.py').matchAll(/"(\w+)": \("\w+", (\d+), (\d+), (\d+)\)/g)) py[m[1]] = [+m[2], +m[3], +m[4]];
  assert.deepEqual(Object.keys(py), ['phone', 'low', 'medium', 'high']);
  assert.deepEqual(py.phone, [640, 360, 15]);
  const main = read('main.js');
  for (const [k, [w, h, fps]] of Object.entries(py)) {
    assert.match(main, new RegExp(`${k}: \\{ fps: ${fps}, w: ${w}, h: ${h} \\}`), `main.js QUALITY.${k}`);
  }
  const eng = /\{ (phone: \d+, low: \d+, medium: \d+, high: \d+) \}\[quality\]/.exec(read('engine.js'));
  assert.ok(eng, 'engine.js fps table');
  assert.deepEqual(Object.fromEntries(eng[1].split(', ').map(p => p.split(': ')).map(([k, v]) => [k, +v])), Object.fromEntries(Object.entries(py).map(([k, v]) => [k, v[2]])));
  const opts = [...read('index.html').matchAll(/<option value="(phone|low|medium|high)">(\d+)p, (\d+) fps<\/option>/g)];
  assert.deepEqual(opts.map(o => [o[1], +o[2], +o[3]]), Object.entries(py).map(([k, v]) => [k, v[1], v[2]]));
});

test('device: main.js uses the device defaults and keeps a picked quality', () => {
  const main = read('main.js');
  assert.match(main, /prefs\.qualityPicked \? prefs\.quality : defaultQuality\(device\)/);
  assert.match(main, /prefs\.qualityPicked = true/);
  assert.match(main, /budget: frameBudgetMB\(device\)/);
  assert.match(main, /networkAdvice\(navigator\.connection/);
  assert.match(read('index.html'), /id="bootGo"/);
  assert.match(read('ui/player.js'), /bytes \+ full \* scale \* scale > budget/);
});
