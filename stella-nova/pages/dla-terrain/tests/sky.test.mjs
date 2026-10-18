// ============================================================================
//  DLA TERRAIN  ·  tests/sky.test.mjs — SKY package checks (node only).
//  Run: node pages/dla-terrain/tests/sky.test.mjs  (CORE's tests.mjs runs it)
//  It tests the DOM-free sky-state.js and the static parts of the SKY
//  shaders and modules (no GPU here).
// ============================================================================
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  skyState, createSky, WEATHER, GLOBALS, ATMO, FRONT_S, solarPosition, moonPosition,
  sunTransmittance, writeSkyGlobals, lightning, todForSunElevation, lightningCells, weatherEnv,
} from '../sky-state.js';
import { createModel, frontSpeed, FORCING, CH, DT, sampleSnap, terrainCells } from '../weather-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const page = join(here, '..');
let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   sky: ' + name); }
  catch (e) { fail++; console.log('  FAIL sky: ' + name + '\n       ' + (e && e.message)); }
}
const deg = (v) => Math.asin(v[1]) * 180 / Math.PI;

check('weather list has the contract presets', () => {
  const ids = WEATHER.map((w) => w.id);
  for (const id of ['clear', 'fair', 'cloudy', 'overcast', 'fog', 'drizzle', 'rain', 'thunderstorm', 'snow', 'blizzard', 'golden-haze'])
    assert.ok(ids.includes(id), id);
});

check('noon sun is high, midnight sun is below the horizon', () => {
  const noon = solarPosition(0.5, 0.25, 46), night = solarPosition(0.0, 0.25, 46);
  assert.ok(Math.abs(noon.elevation - (90 - 46 + 23.44)) < 0.5, 'noon elevation ' + noon.elevation);
  assert.ok(night.elevation < -15, 'midnight ' + night.elevation);
});

check('the sun rises in the east and sets in the west (x east)', () => {
  assert.ok(solarPosition(0.3, 0, 40).dir[0] > 0.5);
  assert.ok(solarPosition(0.7, 0, 40).dir[0] < -0.5);
  assert.ok(solarPosition(0.5, 0, 40).dir[2] > 0.3, 'noon sun is to the south (+z) at 40 N');
});

check('equinox day is 12 h long within 15 min', () => {
  let up = 0;
  for (let i = 0; i < 1440; i++) if (solarPosition(i / 1440, 0, 46).elevation > 0) up++;
  assert.ok(Math.abs(up - 720) < 15, 'minutes up ' + up);
});

check('sun direction is a unit vector', () => {
  for (const tod of [0.1, 0.33, 0.5, 0.8]) {
    const d = solarPosition(tod, 0.6, -30).dir;
    assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-6);
  }
});

check('sunset light is red: blue falls more than red near the horizon', () => {
  const hi = sunTransmittance(0.9), lo = sunTransmittance(0.03);
  assert.ok(hi[2] > 0.6 && hi[0] > 0.85, 'noon ' + hi);
  assert.ok(lo[0] > 3 * lo[2], 'low sun ' + lo);
  assert.deepEqual(sunTransmittance(-0.3), [0, 0, 0]);
});

check('haze (mie) dims the sun', () => {
  assert.ok(sunTransmittance(0.2, 0.2, 3.5)[1] < sunTransmittance(0.2, 0.2, 1)[1]);
});

check('moon phase is 0..1 and full moon lights more', () => {
  for (let s = 0; s < 1; s += 0.05) {
    const m = moonPosition(0.0, s, 46);
    assert.ok(m.phase >= 0 && m.phase < 1 && m.lit >= 0 && m.lit <= 1);
  }
});

check('day ambient is bluer than red, night ambient is dim', () => {
  const d = skyState(0.5, 'clear', 0.3, 46, 0), n = skyState(0.0, 'clear', 0.3, 46, 0);
  assert.ok(d.ambient[2] > d.ambient[0]);
  assert.ok(n.ambient[1] < d.ambient[1] * 0.01);
});

check('overcast removes most direct sun', () => {
  const c = skyState(0.5, 'clear', 0.3, 46, 0), o = skyState(0.5, 'overcast', 0.3, 46, 0);
  assert.ok(o.sunColor[1] < c.sunColor[1] * 0.35, o.sunColor[1] + ' vs ' + c.sunColor[1]);
});

check('stateless front: cloud first, rain after, no jumps', () => {
  let s = skyState(0.5, 'clear', 0.3, 46, 0, { stateless: true });
  let last = null, coverAtRain = -1;
  for (let t = 0.5; t <= FRONT_S + 5; t += 0.5) {
    s = skyState(0.5, 'rain', 0.3, 46, t, s);
    if (coverAtRain < 0 && s.weather[1] > 0.05) coverAtRain = s.weather[0];
    if (last) for (let i = 0; i < 3; i++) assert.ok(Math.abs(s.weather[i] - last.weather[i]) < 0.08, 'jump at ' + t);
    last = s;
  }
  assert.ok(coverAtRain > 0.6, 'cover when rain starts ' + coverAtRain);
  assert.ok(Math.abs(last.weather[1] - 0.75) < 1e-6, 'rain reaches the preset');
});

check('the ground gets wet in rain and dries after', () => {
  const sky = createSky({ worker: false });
  let s;
  for (let t = 0; t < 120; t += 0.5) s = sky.update(0.5, 'rain', 0.3, 46, t);
  const wet = s.wetness;
  assert.ok(wet > 0.8, 'wet ' + wet);
  for (let t = 120; t < 600; t += 1) s = sky.update(0.5, 'clear', 0.3, 46, t);
  assert.ok(s.wetness < wet - 0.3, 'dried to ' + s.wetness);
});

check('snow cover builds up in snow', () => {
  const sky = createSky({ worker: false });
  let s;
  for (let t = 0; t < 120; t += 0.5) s = sky.update(0.4, 'snow', 0.8, 50, t);
  assert.ok(s.snowCover > 0.5, 'snow cover ' + s.snowCover);
  assert.ok(s.temperature < 0, 'temperature ' + s.temperature);
});

check('lightning only in storms, seeded, flash 0..1', () => {
  let nCalm = 0, nStorm = 0;
  for (let t = 0; t < 120; t += 0.05) {
    if (lightning(t, 0.1).flash > 0.2) nCalm++;
    const f = lightning(t, 1).flash;
    assert.ok(f >= 0 && f <= 1);
    if (f > 0.2) nStorm++;
  }
  assert.equal(nCalm, 0);
  assert.ok(nStorm > 20, 'storm flashes ' + nStorm);
  assert.deepEqual(lightning(37.3, 1), lightning(37.3, 1));
});

check('valley fog peaks in the morning and burns off at midday', () => {
  const m = skyState(0.27, 'clear', 0.0, 46, 0), n = skyState(0.55, 'clear', 0.0, 46, 0);
  assert.ok(m.valleyFog > 0.4, 'morning ' + m.valleyFog);
  assert.ok(n.valleyFog < 0.05, 'noon ' + n.valleyFog);
});

check('writeSkyGlobals fills SKY fields, leaves exposure', () => {
  const f = new Float32Array(GLOBALS.floats);
  f[GLOBALS.ambient + 3] = 7;
  const s = skyState(0.4, 'cloudy', 0.3, 46, 3);
  writeSkyGlobals(f, s);
  assert.equal(f[GLOBALS.ambient + 3], 7);
  assert.ok(Math.abs(f[GLOBALS.sunDir + 1] - s.sunDir[1]) < 1e-6);
  assert.ok(Math.abs(f[GLOBALS.weather] - s.weather[0]) < 1e-6);
  assert.ok(Math.abs(f[GLOBALS.sunColor + 3] - 0.4) < 1e-6);
});

check('a call 0..2 s after the last one continues the front (no prev passed)', () => {
  skyState(0.5, 'clear', 0.3, 46, 1000);
  const a = skyState(0.5, 'overcast', 0.3, 46, 1000.5);
  assert.ok(a.weather[0] < 0.2, 'cover jumps to ' + a.weather[0]);
  const b = skyState(0.5, 'overcast', 0.3, 46, 5000, { stateless: true });
  assert.ok(Math.abs(b.weather[0] - 0.92) < 1e-6, 'stateless gives the preset');
});

check('the result has the names of gpu/globals.js packGlobals', () => {
  const s = skyState(0.6, 'thunderstorm', 0.3, 46, 7, { stateless: true });
  for (const k of ['sunIlluminance', 'moonIlluminance', 'fogDensity', 'gust', 'windPhase', 'cover', 'rain', 'snow', 'lightning', 'wetness', 'snowCover', 'storminess', 'season', 'tod'])
    assert.ok(typeof s[k] === 'number' && Number.isFinite(s[k]), k);
});

check('overrides change the preset', () => {
  const s = skyState(0.5, 'clear', 0.3, 46, 3, { cover: 0.5, stateless: true });
  assert.ok(Math.abs(s.weather[0] - 0.5) < 1e-6);
});

check('night exposure stays darker than day exposure would make it', () => {
  const n = skyState(0.0, 'clear', 0.3, 46, 0, { stateless: true });
  assert.ok(n.exposureHint <= 45 && n.exposureHint > 1);
});

const W0 = await import('../render/weather.js');
// ---- the weather model (weather-model.js) ----
// A ridge 1.8 km high across the wind (the wind blows toward +x, east).
function ridgeModel(id, seed = 3) {
  const tn = 128, ws = 20000, H = new Float32Array(tn * tn);
  for (let j = 0; j < tn; j++) for (let i = 0; i < tn; i++) {
    const x = (i / tn - 0.5) * ws;
    H[j * tn + i] = 50 + 1800 * Math.exp(-((x / 2500) ** 2));
  }
  const m = createModel({ seed, prevail: 0 });
  m.setTerrain({ height: H, n: tn, worldSize: ws, seaLevel: 0 });
  return m;
}
const envAt = (tod) => weatherEnv(tod, 0.35, 46);
// mean of field f over the cells with x in [x0, x1] (m)
function band(m, f, x0, x1) {
  let s = 0, k = 0;
  for (let j = 8; j < m.n - 8; j++) for (let i = 0; i < m.n; i++) {
    const x = m.x0 + (i + 0.5) * m.cs;
    if (x >= x0 && x <= x1) { s += f[j * m.n + i]; k++; }
  }
  return s / k;
}

check('model: orographic cloud forms on the windward slope', () => {
  const m = ridgeModel('cloudy');
  m.setPreset('cloudy', null, true); m.init(envAt(0.4), 60);
  for (let i = 0; i < 120; i++) m.step(envAt(0.4));
  const snap = m.snapshot().data, cover = new Float32Array(m.n * m.n);
  for (let k = 0; k < cover.length; k++) cover[k] = snap[k * CH];
  const windward = band(m, cover, -2500, -500), upwind = band(m, cover, -18000, -10000);
  assert.ok(windward > upwind + 0.2, `windward cover ${windward.toFixed(2)} vs upwind ${upwind.toFixed(2)}`);
});

check('model: the rain shadow on the lee is drier', () => {
  const m = ridgeModel('rain');
  m.setPreset('rain', null, true); m.init(envAt(0.4), 30);
  m.acc.fill(0);
  for (let i = 0; i < 180; i++) m.step(envAt(0.4));
  const accW = band(m, m.acc, -3000, -500), accL = band(m, m.acc, 6000, 14000);
  const qW = band(m, m.q, -3000, -500), qL = band(m, m.q, 6000, 14000);
  assert.ok(accW > 5 * accL, `rain windward ${accW.toFixed(0)} vs lee ${accL.toFixed(0)}`);
  assert.ok(qL < qW - 0.2, `vapour windward ${qW.toFixed(2)} vs lee ${qL.toFixed(2)} g/kg`);
});

check('model: fronts move at the set speed', () => {
  const m = ridgeModel('fair');
  m.setPreset('fair', null, true); m.init(envAt(0.4), 10);
  m.setPreset('rain');
  const f0 = m.frontPos()[0];
  for (let i = 0; i < 20; i++) m.step(envAt(0.4));
  const f1 = m.frontPos()[0];
  const v = (f1.s - f0.s) / (20 * DT);
  assert.ok(Math.abs(v - frontSpeed('rain')) < 1e-6, `speed ${v} vs ${frontSpeed('rain')}`);
  assert.ok(v > 7 && v < 16, 'a real front speed ' + v);
  // ahead of the line the old air, behind it the new: the cover rises as the front passes x = 0
  const at = (mm) => sampleSnap(mm.snapshot(), -12000, 0)[0];
  const before = at(m);
  while (m.frontPos().length && m.frontPos()[0].s < 2000) m.step(envAt(0.4));
  assert.ok(at(m) > before + 0.3, `cover at x = -12 km: ${before.toFixed(2)} -> ${at(m).toFixed(2)}`);
});

check('model: thunderstorms only when the air is unstable', () => {
  const run = (id) => {
    const m = ridgeModel(id);
    m.setPreset(id, null, true);
    const envs = []; for (let i = 0; i < 100; i++) envs.push(envAt(0.35 + i * 3 * DT / 86400));
    m.init(envs);
    for (let i = 0; i < 60; i++) m.step(envAt(0.55 + i * DT / 86400));
    const d = m.snapshot().data;
    let storm = 0, cu = 0;
    for (let k = 0; k < m.n * m.n; k++) { storm = Math.max(storm, d[k * CH + 4]); cu = Math.max(cu, m.cu[k]); }
    return { storm, cu };
  };
  const fair = run('fair'), cloudy = run('cloudy'), storm = run('thunderstorm');
  assert.ok(fair.cu > 0.2, 'fair afternoon has cumulus ' + fair.cu.toFixed(2));
  assert.equal(fair.storm, 0, 'no storm in fair weather');
  assert.equal(cloudy.storm, 0, 'no storm in cloudy weather');
  assert.ok(storm.storm > 0.6, 'unstable afternoon storms ' + storm.storm.toFixed(2));
  assert.ok(FORCING.fair.instab < 0.55 && FORCING.thunderstorm.instab > 0.55);
});

check('model: valley fog forms on a clear night and lifts after sunrise', () => {
  const m = ridgeModel('clear');
  m.setPreset('clear', null, true); m.init(envAt(0.85), 20);
  let tod = 0.85;
  for (let i = 0; i < 480; i++) { m.step(envAt(tod)); tod = (tod + DT / 86400) % 1; }   // to 04:24
  const snap = (mm) => { const d = mm.snapshot().data; const f = new Float32Array(mm.n * mm.n); for (let k = 0; k < f.length; k++) f[k] = d[k * CH + 5]; return f; };
  const night = snap(m);
  const valley = band(m, night, -4500, -3000), ridge = band(m, night, -700, 700);
  assert.ok(valley > 0.3, 'valley fog at night ' + valley.toFixed(2));
  assert.ok(ridge < valley * 0.5, `ridge ${ridge.toFixed(2)} vs valley ${valley.toFixed(2)}`);
  for (let i = 0; i < 330; i++) { m.step(envAt(tod)); tod += DT / 86400; }               // to 09:54
  const day = band(m, snap(m), -4500, -3000);
  assert.ok(day < 0.05, 'fog burnt off by 10:00: ' + day.toFixed(3));
});

// ---- stutter and frame-rate independence (sky-state.js createSky) ----
// tod moves at 100 game s per s, as with the default day speed
function runSky(schedule, T, wx = 'rain', change = null) {
  const sky = createSky({ worker: false });
  let t = 0, st = sky.update(0.45, wx, 0.35, 46, 0), k = 0;
  const frames = [st];
  while (t < T - 1e-9) {
    const dt = Math.min(schedule[k++ % schedule.length], T - t);
    t += dt;
    st = sky.update(0.45 + t * 100 / 86400, change && t >= change.at ? change.id : wx, 0.35, 46, t);
    frames.push(st);
  }
  return { sky, st, frames };
}

check('frame-rate independence: two dt schedules give the same weather', () => {
  const T = 20;
  const a = runSky([1 / 30], T, 'fair', { at: 2, id: 'thunderstorm' });
  const b = runSky([1 / 144, 1 / 60, 1 / 24, 1 / 90], T, 'fair', { at: 2, id: 'thunderstorm' });
  assert.ok(Math.abs(a.st.gameT - b.st.gameT) < 1e-6, `weather time ${a.st.gameT} vs ${b.st.gameT}`);
  for (let c = 0; c < CH; c++) {
    const tol = 1e-3 * Math.max(1, Math.abs(a.st.local[c]));
    assert.ok(Math.abs(a.st.local[c] - b.st.local[c]) < tol, `channel ${c}: ${a.st.local[c]} vs ${b.st.local[c]}`);
  }
  const fa = a.sky.sim.driver.model.frontPos(), fb = b.sky.sim.driver.model.frontPos();
  assert.equal(fa.length, fb.length);
  if (fa.length) assert.ok(Math.abs(fa[0].s - fb[0].s) < 1e-3);
});

check('stutter: a steady camera sees small frame-to-frame changes, also through a front', () => {
  const r = runSky([1 / 60], 40, 'fair', { at: 1, id: 'thunderstorm' });
  let worst = 0, worstWind = 0, at = 0;
  for (let i = 2; i < r.frames.length; i++) {
    const p = r.frames[i - 1], q = r.frames[i];
    for (let c = 0; c < 3; c++) { const d = Math.abs(q.weather[c] - p.weather[c]); if (d > worst) { worst = d; at = q.t; } }
    worstWind = Math.max(worstWind, Math.hypot(q.wind[0] - p.wind[0], q.wind[1] - p.wind[1]));
  }
  // a front takes several seconds over the camera: at 60 fps no field may
  // move by more than 2 % of its range in one frame
  assert.ok(worst < 0.02, `largest step of cover/rain/snow ${worst.toFixed(4)} at t ${at.toFixed(2)}`);
  assert.ok(worstWind < 0.3, 'wind step m/s ' + worstWind.toFixed(3));
});

check('stutter: rain drops move by their velocity per frame, also after an hour', () => {
  const st = { clock: 3600 };
  const R = 32, h = [0.31, 0.77, 0.52], cam = [10, 500, -20];
  let prev = null, worst = 0;
  for (let i = 0; i < 240; i++) {
    const dt = 1 / 60;
    st.clock += dt;
    // gusty wind that changes every frame
    const wind = [6 + 3 * Math.sin(i * 0.3), 2 * Math.cos(i * 0.21)];
    const ph = W0.precipPhases(st, wind, dt, R, 26);
    const p = W0.rainDropPos(5, ph, cam, R, h);
    if (prev) {
      const d = [p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]].map((v) => v - Math.round(v / (2 * R)) * 2 * R);
      worst = Math.max(worst, Math.hypot(...d));
    }
    prev = p;
  }
  // 9.75 m/s fall and at most 10 m/s wind: under 0.25 m a frame (the
  // old wind x time formula moved a drop by tens of m in one gusty frame)
  assert.ok(worst < 0.25, 'largest drop step ' + worst.toFixed(3) + ' m');
});

check('lightning: the flash energy does not depend on the frame rate', () => {
  const cells = [{ x: 2000, z: 1000, s: 1 }, { x: -5000, z: 3000, s: 0.8 }];
  const energy = (fps) => {
    const memo = new Map();
    let e = 0, t = 0;
    while (t < 60) { const t1 = t + 1 / fps; e += lightningCells(t, t1, cells, [0, 0, 0], 3, memo).flash / fps; t = t1; }
    return e;
  };
  const e30 = energy(30), e144 = energy(144);
  assert.ok(e30 > 0.05, 'some lightning ' + e30);
  assert.ok(Math.abs(e30 - e144) / e144 < 0.03, `flash energy 30 fps ${e30.toFixed(4)} vs 144 fps ${e144.toFixed(4)}`);
  assert.equal(lightningCells(0, 60, [], [0, 0, 0]).flash, 0, 'no cells, no lightning');
});

// ---- render modules (DOM-free parts) ----
const W = await import('../render/weather.js');
check('the DLA bolt reaches down and has one main channel', () => {
  const g = W.createBoltGrower(42, 120).finish();
  const b = W.boltSegments(g.model);
  assert.ok(b.minY <= -120, 'depth ' + b.minY);
  assert.ok(b.mainCount > 60 && b.count <= 900 && b.count > b.mainCount);
  for (let i = 0; i < b.mainCount; i++) assert.equal(b.segs[i * 8 + 3], 1);
  const g2 = W.createBoltGrower(42, 120).finish();
  assert.equal(W.boltSegments(g2.model).count, b.count, 'seeded');
});
const SK = await import('../render/sky.js');
check('todForSunElevation finds golden hour for the season and latitude', () => {
  for (const [season, lat] of [[0.35, 46], [0.85, 46], [0.0, 10], [0.5, -35]]) {
    const am = todForSunElevation(4, season, lat, false), pm = todForSunElevation(4, season, lat, true);
    assert.ok(am > 0.15 && am < 0.5 && pm > 0.5 && pm < 0.85, `${season} ${lat}: ${am} ${pm}`);
    assert.ok(Math.abs(solarPosition(am, season, lat).elevation - 4) < 0.01);
    assert.ok(Math.abs(solarPosition(pm, season, lat).elevation - 4) < 0.01);
  }
  // summer mornings at 46 N are golden earlier than winter mornings
  assert.ok(todForSunElevation(4, 0.25, 46) < todForSunElevation(4, 0.75, 46));
  // polar night: the sun never reaches 4 deg
  assert.equal(todForSunElevation(4, 0.75, 80), null);
});

check('cloud layer sits over the valleys, storms bring it down', () => {
  const t = { seaLevel: 0, heightScale: 2000 };
  const fair = SK.cloudLayer(t, { cover: 0.3, cumulus: 1, storm: 0, rain: 0, fog: 2e-5 });
  const storm = SK.cloudLayer(t, { cover: 0.9, cumulus: 1, storm: 1, rain: 1, fog: 2e-4 });
  assert.ok(fair.base > 900 && fair.top > fair.base + 500 && fair.anvil > fair.top);
  assert.ok(storm.base < fair.base);
});
check('f16 packs the weather texture values', () => {
  const back = (h) => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e === 0 ? s * m * 2 ** -24 : s * (1 + m / 1024) * 2 ** (e - 15); };
  for (const v of [0, 0.5, 1, 0.3333, 2874.4, -12.5, 65000, 1e-5]) {
    const r = back(SK.f16(v));
    assert.ok(Math.abs(r - Math.min(v, 65504)) <= Math.max(Math.abs(v) * 1e-3, 1e-5), v + ' -> ' + r);
  }
});
check('SkyU offsets match the WGSL struct', () => {
  const src = readFileSync(join(page, 'shaders/sky.wgsl'), 'utf8');
  const body = src.slice(src.indexOf('struct SkyU {'), src.indexOf('}', src.indexOf('struct SkyU {')));
  const names = [...body.matchAll(/^\s+(\w+): vec4f/gm)].map((m) => m[1]);
  assert.equal(names.length * 4, SK.SKYU_FLOATS);
  names.forEach((n, i) => assert.equal(SK.SKYU[n], i * 4, n));
});
check('splitSkyLibrary cuts at the entry line only', () => {
  const src = readFileSync(join(page, 'shaders/sky.wgsl'), 'utf8');
  const lib = SK.splitSkyLibrary(src);
  assert.ok(lib.includes('fn cloudShadow') && !lib.includes('@compute') && lib.includes('struct SkyU'));
});

// ---- static checks of the shaders and modules (only when they exist) ----
const wgslFiles = ['shaders/sky.wgsl', 'shaders/clouds.wgsl', 'shaders/weather.wgsl'];
for (const f of wgslFiles) {
  const p = join(page, f);
  if (!existsSync(p)) continue;
  const src = readFileSync(p, 'utf8');
  check(f + ': no unparenthesised mixed && ||', () => {
    for (const [i, line] of src.split('\n').entries()) {
      const code = line.replace(/\/\/.*$/, '');
      if (code.includes('&&') && code.includes('||') && !/\(\s*[^()]*(&&|\|\|)[^()]*\)/.test(code))
        assert.fail('line ' + (i + 1) + ': ' + code.trim());
    }
  });
  check(f + ': no built-in smoothstep (Metal: undefined for a >= b)', () => {
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!/[^_\w]smoothstep\(/.test(code));
  });
  check(f + ': no reserved WGSL words as names', () => {
    for (const w of ['patch', 'filter', 'sample', 'texture', 'module', 'output', 'input', 'common'])
      assert.ok(!new RegExp('\\b(let|var|const) ' + w + '\\b').test(src), w);
  });
  check(f + ': credits our sources in the header', () => {
    assert.ok(/pages\/forge|pages\/weather-map|pages\/volume-noise|Hillaire/.test(src.slice(0, 4000)));
  });
}
if (existsSync(join(page, 'shaders/sky.wgsl'))) {
  check('sky.wgsl atmosphere constants match sky-state.js ATMO', () => {
    const src = readFileSync(join(page, 'shaders/sky.wgsl'), 'utf8');
    for (const v of [ATMO.rayleigh[0], ATMO.rayleigh[2], ATMO.mieS, ATMO.ozone[1]]) {
      assert.ok(src.includes(String(v)) || src.includes(v.toExponential()), 'missing ' + v);
    }
  });
}

console.log(`sky: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
