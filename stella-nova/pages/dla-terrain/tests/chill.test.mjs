// ============================================================================
//  DLA TERRAIN  ·  tests/chill.test.mjs — the weather moves slowly and
//  nothing pops (package SKY; node only, no GPU, no browser).
//  Run: node pages/dla-terrain/tests/chill.test.mjs
// ----------------------------------------------------------------------------
//  The user: "it feels so computer generated with no CHILL to the
//  dynamics". This test runs the stateful sky (sky-state.js createSky with
//  the inline weather model) over one simulated day at the default day
//  speed, at 20 frames a second, with three weather changes from the UI
//  (fair -> thunderstorm -> clear -> overcast). Each value at the camera
//  must change by less than a set rate per real second, frame by frame:
//    cover, rain, snow, storm  < MAX.frac per s (0..1 values: a full
//                              change takes 10 s or more)
//    wind speed                < MAX.wind m/s per s
//    haze (fog per m)          < MAX.fogLog per s, in log
//    sun and sky light         < MAX.light x SUN_ILLUM per s (full sun to
//                              none in 4 s or more: a cloud edge passing)
//  It also checks the weather clock (6 .. 40 x real time) and the visible
//  cloud drift caps of render/sky.js.
// ============================================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSky, SUN_ILLUM, RATE_MIN, RATE_MAX, RATE_FRONT, FRONT_BOOST_S, frontBoost, weatherRate } from '../sky-state.js';
import { todRate } from '../ui.js';
import { CLOUD_DRIFT_RATE, HAZE_DRIFT_RATE, CLOUD_RISE } from '../render/sky.js';

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   chill: ' + name); }
  catch (e) { fail++; console.log('  FAIL chill: ' + name + '\n       ' + (e && e.message)); }
}

export const MAX = { frac: 0.1, wind: 2.5, fogLog: 0.6, light: 0.25 };
// main.js app.todSpeed (the day length slider): read from the source
const DEFAULT_TOD_SPEED = +(/todSpeed: ([0-9.]+)/.exec(readFileSync(new URL('../main.js', import.meta.url), 'utf8')) || [0, 0.04])[1];

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
function runDay(todSpeed, fps = 20) {
  const sky = createSky({ worker: false, seed: 3 });
  // a synthetic range (the model needs ground for its lift and its storms)
  const tn = 128, height = new Float32Array(tn * tn);
  for (let j = 0; j < tn; j++) for (let i = 0; i < tn; i++) {
    const x = i / tn, z = j / tn;
    height[j * tn + i] = 900 + 700 * Math.sin(x * 9.1 + 1) * Math.cos(z * 7.3) + 500 * Math.sin((x + z) * 17);
  }
  sky.sim.setCamera([0, 1200, 0]);
  sky.sim.setTerrain({ n: tn, worldSize: 20000, heightScale: 2500, seaLevel: -100, height });
  const minPerS = todRate(todSpeed);           // game minutes per real second
  const daySec = 1440 / minPerS;
  const dt = 1 / fps;
  const plan = [[0, 'fair'], [daySec / 4, 'thunderstorm'], [daySec / 2, 'clear'], [0.75 * daySec, 'overcast']];
  let tod = 0.2, t = 0, prev = null, id = 'fair';
  const worst = { cover: 0, rain: 0, snow: 0, storm: 0, wind: 0, fog: 0, light: 0, amb: 0, rateLo: 1e9, rateHi: 0 };
  const where = {};
  const n = Math.ceil(daySec / dt);
  for (let i = 0; i <= n; i++) {
    for (const [at, w] of plan) if (t >= at && t - dt < at) id = w;
    const s = sky.update(tod, id, 0.3, 46, t);
    if (prev && i > 40) {
      const r = (a, b) => Math.abs(a - b) / dt;
      const upd = (k, v) => { if (v > worst[k]) { worst[k] = v; where[k] = `t ${t.toFixed(1)} s, tod ${tod.toFixed(3)}, ${id}`; } };
      upd('cover', r(s.wx.cover, prev.wx.cover));
      upd('rain', r(s.wx.rain, prev.wx.rain));
      upd('snow', r(s.wx.snow, prev.wx.snow));
      upd('storm', r(s.wx.storm, prev.wx.storm));
      upd('wind', r(Math.hypot(s.wind[0], s.wind[1]), Math.hypot(prev.wind[0], prev.wind[1])));
      upd('fog', r(Math.log(Math.max(s.wx.fog, 1e-7)), Math.log(Math.max(prev.wx.fog, 1e-7))));
      upd('light', r(lum(s.sunColor), lum(prev.sunColor)) / SUN_ILLUM);
      upd('amb', r(lum(s.ambient), lum(prev.ambient)) / SUN_ILLUM);
      worst.rateLo = Math.min(worst.rateLo, s.gameRate);
      worst.rateHi = Math.max(worst.rateHi, s.gameRate);
    }
    prev = s;
    t += dt;
    tod = (tod + minPerS * dt / 1440) % 1;
  }
  sky.dispose();
  return { worst, where, daySec };
}

const T0 = Date.now();
const day = runDay(DEFAULT_TOD_SPEED);
const fmt = (o) => Object.entries(o).map(([k, v]) => `${k} ${typeof v === 'number' ? v.toFixed(4) : v}`).join(', ');
console.log(`  chill: one day at the default speed = ${day.daySec.toFixed(0)} s real, worst per s: ${fmt(day.worst)} (${((Date.now() - T0) / 1000).toFixed(1)} s)`);

check('cover, rain, snow and storm change by less than ' + MAX.frac + ' per s', () => {
  for (const k of ['cover', 'rain', 'snow', 'storm']) assert.ok(day.worst[k] < MAX.frac, `${k} ${day.worst[k].toFixed(3)} per s at ${day.where[k]}`);
});
check('the wind speed changes by less than ' + MAX.wind + ' m/s per s', () => {
  assert.ok(day.worst.wind < MAX.wind, `wind ${day.worst.wind.toFixed(2)} at ${day.where.wind}`);
});
check('the haze changes by less than ' + MAX.fogLog + ' (log) per s', () => {
  assert.ok(day.worst.fog < MAX.fogLog, `fog ${day.worst.fog.toFixed(3)} at ${day.where.fog}`);
});
check('sun and sky light change by less than ' + MAX.light + ' x SUN_ILLUM per s', () => {
  assert.ok(day.worst.light < MAX.light, `sun ${day.worst.light.toFixed(3)} at ${day.where.light}`);
  assert.ok(day.worst.amb < MAX.light, `ambient ${day.worst.amb.toFixed(3)} at ${day.where.amb}`);
});
check('the default day is calm: 20 real minutes or more for a full day', () => {
  assert.ok(day.daySec >= 1200, `day ${day.daySec.toFixed(0)} s at todSpeed ${DEFAULT_TOD_SPEED}`);
});
const fast = runDay(0.15);
console.log(`  chill: one day at todSpeed 0.15 = ${fast.daySec.toFixed(0)} s real, worst per s: ${fmt(fast.worst)}`);
check('at a fast day (todSpeed 0.15) the weather values still change slowly', () => {
  for (const k of ['cover', 'rain', 'snow', 'storm']) assert.ok(fast.worst[k] < MAX.frac, `${k} ${fast.worst[k].toFixed(3)} at ${fast.where[k]}`);
  assert.ok(fast.worst.wind < MAX.wind, 'wind ' + fast.worst.wind.toFixed(2));
});
check('the weather clock stays in RATE_MIN .. RATE_FRONT (6 .. 60 x real time)', () => {
  assert.ok(RATE_MIN === 6 && RATE_MAX === 40 && RATE_FRONT <= 60, `${RATE_MIN} .. ${RATE_MAX}, front ${RATE_FRONT}`);
  assert.ok(day.worst.rateLo >= RATE_MIN - 1e-6 && day.worst.rateHi <= RATE_FRONT + 1e-6, `${day.worst.rateLo} .. ${day.worst.rateHi}`);
  assert.ok(frontBoost(-1) === 0 && frontBoost(0) === 0 && frontBoost(30) === 1 && frontBoost(FRONT_BOOST_S) === 0, 'frontBoost envelope');
  assert.ok(weatherRate(0) === RATE_MIN && weatherRate(1e6) === RATE_MAX, 'weatherRate caps');
});
check('the visible drift of clouds and haze is capped in real time', () => {
  assert.ok(CLOUD_DRIFT_RATE <= 8 && HAZE_DRIFT_RATE <= 8, `${CLOUD_DRIFT_RATE} ${HAZE_DRIFT_RATE}`);
  assert.ok(CLOUD_RISE[0] <= 3 && CLOUD_RISE[1] <= 6, CLOUD_RISE.join(' '));
});

console.log(`chill: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
