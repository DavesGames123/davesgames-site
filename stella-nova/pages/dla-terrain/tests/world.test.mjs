// tests/world.test.mjs — POLISH checks of world-state.js (node, no GPU).
// Run alone: node stella-nova/pages/dla-terrain/tests/world.test.mjs
//
// What it checks: the URL hash round trip (options diff, time, weather,
// season, plants, water, the three camera shots), the per-group dice
// (only that group changes), the locks of "Randomise everything" (a locked
// group keeps its values), the same seed gives the same world, the time
// dice gives golden light most often, and the history back and forward.

import * as W from '../world-state.js';
import * as Stub from '../gpu/stub-terrain.js';

let lib = Stub;
try { lib = await import('../../../lib/dla-terrain.js'); } catch { /* the stub */ }
let sky = null;
try { sky = await import('../sky-state.js'); } catch { /* no sun maths */ }

let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok ${pass + fail} world: ${name}`); }
  else { fail++; console.log(`not ok ${pass + fail} world: ${name} ${extra}`); }
}
const ctx = { solarPosition: sky && sky.solarPosition, latitude: 46, weatherIds: sky ? sky.WEATHER.map(w => w.id) : ['fair', 'clear'] };
const pid = Object.keys(lib.PRESETS)[0];
const w0 = W.cloneWorld({ opts: { ...lib.defaults(), ...lib.PRESETS[pid].opts }, preset: pid });
const groupKeys = g => lib.OPTIONS.filter(d => d.group === g).map(d => d.key);
const same = (a, b, keys) => keys.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]));

// hash
const h0 = W.encodeHash(w0, lib);
ok(h0.startsWith('#s=') && h0.includes('p=' + pid) && !h0.includes('o='), 'a preset world has a short hash', h0);
for (const seed of [3, 77, 4242]) {
  const w = W.rollWorld(w0, [], seed, lib, ctx);
  const h = W.encodeHash(w, lib), d = W.decodeHash(h, lib);
  ok(d && W.encodeHash({ ...w, ...d }, lib) === h, 'hash round trip, seed ' + seed);
  ok(d && same(d.opts, w.opts, lib.OPTIONS.map(o => o.key).filter(k => k !== 'archetype')), 'hash keeps every option, seed ' + seed);
  ok(d && d.weather === w.weather && Math.abs(d.tod - w.tod) < 1e-3 && Math.abs(d.season - w.season) < 1e-3, 'hash keeps time, weather, season, seed ' + seed);
}
for (const cam of [{ kind: 'drone', path: 'river', pick: 3 }, { kind: 'orbit', yaw: 1.2, pitch: -0.3, distK: 0.5, tx: 0.1, tz: -0.2 }, { kind: 'fly', x: 120, y: 900, z: -340, yaw: 0.5, pitch: -0.1 }]) {
  const d = W.decodeHash(W.encodeHash({ ...w0, cam }, lib), lib);
  ok(d && JSON.stringify(d.cam) === JSON.stringify(cam), 'hash keeps the camera ' + cam.kind, JSON.stringify(d && d.cam));
}
ok(W.decodeHash('', lib) === null && W.decodeHash('#foo=1', lib) === null, 'no world in an empty or foreign hash');
const bad = W.decodeHash('#s=5&o=heightScale_999999~nope_3~mask_zzz&t=7&w=fair', lib);
ok(bad && bad.opts.heightScale <= lib.OPTIONS.find(d => d.key === 'heightScale').max && bad.tod <= 1, 'a bad hash is clamped');

// one group
for (const g of W.LIB_GROUPS) {
  if (!groupKeys(g).length) continue;
  const w = W.rollGroup(w0, g, 99, lib, ctx);
  const others = lib.OPTIONS.filter(d => d.group !== g && d.key !== 'seed').map(d => d.key);
  ok(same(w.opts, w0.opts, others) && w.tod === w0.tod && w.weather === w0.weather, 'the ' + g + ' dice changes only ' + g);
  ok(!same(w.opts, w0.opts, groupKeys(g)), 'the ' + g + ' dice changes ' + g);
}
const ex = { Sky: 'weather', Time: 'tod', Season: 'season', Vegetation: 'veg', Water: 'water', Camera: 'cam' };
for (const [g, k] of Object.entries(ex)) {
  let changed = false;
  for (let s = 1; s < 6 && !changed; s++) changed = JSON.stringify(W.rollGroup(w0, g, s, lib, ctx)[k]) !== JSON.stringify(w0[k]);
  const w = W.rollGroup(w0, g, 5, lib, ctx);
  const rest = Object.values(ex).filter(x => x !== k);
  ok(changed && rest.every(x => JSON.stringify(w[x]) === JSON.stringify(w0[x])) && same(w.opts, w0.opts, Object.keys(w0.opts)), 'the ' + g + ' dice changes only ' + k);
}

// everything, with locks
const locks = ['Erosion', 'Climate', 'Sky', 'Camera'];
const a = W.rollWorld(w0, locks, 1234, lib, ctx), b = W.rollWorld(w0, locks, 1234, lib, ctx);
ok(W.encodeHash(a, lib) === W.encodeHash(b, lib), 'the same seed gives the same world');
ok(same(a.opts, w0.opts, groupKeys('Erosion').concat(groupKeys('Climate'))), 'locked terrain groups keep their options');
ok(a.weather === w0.weather && a.cam === w0.cam, 'locked Sky and Camera keep their values');
ok(!same(a.opts, w0.opts, groupKeys('DLA ridges')), 'an unlocked group changes');
const all = W.rollWorld(w0, W.ALL_GROUPS, 5, lib, ctx);
ok(JSON.stringify(all) === JSON.stringify(W.cloneWorld(w0)), 'all groups locked: nothing changes');

// the time dice: golden light (sun 2..11 degrees) is the most common band
if (sky) {
  let golden = 0, night = 0;
  for (let s = 1; s <= 300; s++) {
    const t = W.rollGroup(w0, 'Time', s, lib, ctx).tod;
    const e = sky.solarPosition(t, w0.season, 46).elevation;
    if (e > 1 && e < 12) golden++;
    if (e < -6) night++;
  }
  ok(golden > 90 && night < 60, `the time dice favours golden light (${golden} golden, ${night} night of 300)`);
}

// history
const H = W.createHistory(3);
H.push('#a'); H.push('#b'); H.push('#c'); H.push('#d');
ok(H.size === 3 && H.current === '#d' && H.back() === '#c' && H.back() === '#b' && !H.canBack, 'history keeps the last 3');
H.push('#e');
ok(!H.canForward && H.current === '#e' && H.back() === '#b' && H.forward() === '#e', 'a push after back drops the forward worlds');

console.log(`# world: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
