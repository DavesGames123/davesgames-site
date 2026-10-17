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
  sunTransmittance, writeSkyGlobals, lightning, todForSunElevation,
} from '../sky-state.js';

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

check('a front: cloud first, rain after, no jumps', () => {
  const sky = createSky();
  let last = null, coverAtRain = -1;
  for (let t = 0; t <= FRONT_S + 5; t += 0.5) {
    const s = sky.update(0.5, t < 1 ? 'clear' : 'rain', 0.3, 46, t);
    if (coverAtRain < 0 && s.weather[1] > 0.05) coverAtRain = s.weather[0];
    if (last) for (let i = 0; i < 3; i++) assert.ok(Math.abs(s.weather[i] - last.weather[i]) < 0.08, 'jump at ' + t);
    last = s;
  }
  assert.ok(coverAtRain > 0.6, 'cover when rain starts ' + coverAtRain);
  assert.ok(Math.abs(last.weather[1] - 0.75) < 1e-6, 'rain reaches the preset');
});

check('the ground gets wet in rain and dries after', () => {
  const sky = createSky();
  let s;
  for (let t = 0; t < 120; t += 0.5) s = sky.update(0.5, 'rain', 0.3, 46, t);
  const wet = s.wetness;
  assert.ok(wet > 0.8, 'wet ' + wet);
  for (let t = 120; t < 600; t += 1) s = sky.update(0.5, 'clear', 0.3, 46, t);
  assert.ok(s.wetness < wet - 0.3, 'dried to ' + s.wetness);
});

check('snow cover builds up in snow', () => {
  const sky = createSky();
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
