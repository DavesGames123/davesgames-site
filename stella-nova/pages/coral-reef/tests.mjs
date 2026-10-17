// ============================================================================
//  CORAL REEF  ·  node tests (no browser):  node tests.mjs
// ----------------------------------------------------------------------------
//  The DOM-free modules: reef.js (growth), colour.js (colour by) and
//  saver.js (shots and camera fit).
//    forms ........ each species grows its form (fan planar, table wide,
//                   staghorn tall, brain compact)
//    floor ........ no polyp is under the sand or its rock, in any preset
//    current ...... a current skews the growth upstream
//    budget ....... step() keeps to its time budget; bleaching stops growth
//    colour ....... t of each mode, natural colours, gradient data
//    saver ........ the shot list and the framing for 16:9 and 9:16
// ============================================================================
import { createReef, growPreset, shapeOf, SPECIES, SPECIES_IDS, PRESETS, PRESET_IDS, sandY, rockY, bleachLevel, speciesHook } from './reef.js';
import { MODES, MODE_IDS, colourT, naturalRGB, fieldsOf, polypData } from './colour.js';
import { shotList, frameFit, projectedBox, SAVER_GRADIENTS } from './saver.js';
import { sample, GRADIENTS } from '../../lib/growth-gradients.js';

let pass = 0, fail = 0;
function ok(cond, name, info = '') {
  if (cond) { pass++; } else { fail++; console.log(`FAIL ${name} ${info}`); }
}
const f2 = v => (+v).toFixed(2);

function colony(id, o = {}) {
  const r = createReef({ seed: o.seed ?? 5, env: { strength: o.strength ?? 0.3 } });
  if (o.dir !== undefined) r.setCurrent(o.dir, o.strength ?? 0.3);
  const c = r.addColony(id, 0, 0, { cap: o.cap ?? 1200 });
  r.growAll();
  return { r, c, s: shapeOf(c, c.user.normal) };
}

// ── forms ───────────────────────────────────────────────────────────────────
{
  const st = colony('staghorn'), fan = colony('fan'), tab = colony('table'), bo = colony('boulder'), fi = colony('finger');
  console.log(`forms: staghorn w ${f2(st.s.width)} h ${f2(st.s.height)} | fan w ${f2(fan.s.width)} h ${f2(fan.s.height)} thick ${f2(fan.s.thickness)} | table w ${f2(tab.s.width)} h ${f2(tab.s.height)} | brain w ${f2(bo.s.width)} h ${f2(bo.s.height)} fill ${bo.s.fill.toFixed(3)} vs staghorn ${st.s.fill.toFixed(4)}`);
  for (const [id, x] of [['staghorn', st], ['fan', fan], ['table', tab], ['boulder', bo], ['finger', fi]]) ok(x.c.count === 1200, `${id} grows to its cap`, x.c.count);
  ok(st.s.height > 1.2 * st.s.width, 'staghorn is taller than wide', `${f2(st.s.height)} vs ${f2(st.s.width)}`);
  ok(fan.s.thickness < 0.01 * fan.s.width, 'sea fan is planar (thin across its plane)', `${fan.s.thickness} vs ${f2(fan.s.width)}`);
  ok(fan.s.width > 0.6 * fan.s.height, 'sea fan spreads wide in its plane', `${f2(fan.s.width)} vs ${f2(fan.s.height)}`);
  // the fan plane is across the current: its normal is the current direction
  const fn = colony('fan', { dir: 90 }); const n = fn.c.user.normal;
  ok(Math.abs(n[0]) < 1e-9 && Math.abs(n[1] - 1) < 1e-9, 'fan normal follows the current direction', n.join(','));
  ok(shapeOf(fn.c, [0, 1]).thickness < 0.01 * fn.s.width, 'fan across a current at 90 degrees is planar in x-y');
  ok(tab.s.width > 3 * tab.s.height, 'table coral is wider than tall', `${f2(tab.s.width)} vs ${f2(tab.s.height)}`);
  ok(bo.s.fill > 10 * st.s.fill, 'brain coral is compact (fill of its hemisphere)', `${bo.s.fill.toFixed(3)} vs ${st.s.fill.toFixed(4)}`);
  ok(bo.s.height < bo.s.width, 'brain coral is a dome (lower than wide)', `${f2(bo.s.height)} vs ${f2(bo.s.width)}`);
  ok(fi.s.height > 0 && fi.c.sp.r0 > st.c.sp.r0, 'finger coral grows with thicker polyps than staghorn');
  // a seed gives the same colony
  const a = colony('staghorn', { cap: 300 }), b = colony('staghorn', { cap: 300 });
  ok(a.c.model.toCSV() === b.c.model.toCSV(), 'the same seed grows the same colony');
}

// ── floor ───────────────────────────────────────────────────────────────────
{
  let worst = Infinity, total = 0;
  for (const pid of PRESET_IDS) {
    const r = growPreset(pid, 11, { capTotal: 6000 });
    total += r.count;
    for (let g = 0; g < r.count; g++) {
      const c = r.colonies[r.col[g]], x = r.px[g], z = r.pz[g];
      const floor = Math.max(sandY(x, z), rockY(c.user.rock, x, z));
      worst = Math.min(worst, r.py[g] - floor);
    }
    ok(r.colonies.length === PRESETS[pid].mix.length, `${pid}: one colony per mix entry`, `${r.colonies.length}`);
  }
  console.log(`floor: ${total} polyps in ${PRESET_IDS.length} presets, least height over the floor ${worst.toExponential(2)}`);
  ok(worst > -1e-3, 'no polyp is under the seabed', worst);
}

// ── current ─────────────────────────────────────────────────────────────────
{
  const east = colony('staghorn', { dir: 0, strength: 1, cap: 1500 }).s.mean[0];
  const west = colony('staghorn', { dir: 180, strength: 1, cap: 1500 }).s.mean[0];
  const calm = colony('staghorn', { dir: 0, strength: 0, cap: 1500 }).s.mean[0];
  const north = colony('boulder', { dir: 90, strength: 1, cap: 1500 }).s.mean[2];
  console.log(`current: mean x with the current to +x ${f2(east)}, to -x ${f2(west)}, none ${f2(calm)}; brain mean z with the current to +z ${f2(north)}`);
  ok(east < -2, 'a current toward +x grows the colony toward -x (upstream)', east);
  ok(west > 2, 'a current toward -x grows the colony toward +x (upstream)', west);
  ok(Math.abs(calm) < Math.min(-east, west) / 2, 'no current: no strong skew', calm);
  ok(north < 0, 'a current toward +z skews a brain coral toward -z', north);
}

// ── budget and bleaching ───────────────────────────────────────────────────
{
  const r = createReef({ seed: 2 }); r.loadPreset('mixed');
  const t0 = performance.now(); const n = r.step(1000, 6, 0, 1e6); const dt = performance.now() - t0;
  console.log(`budget: step(budget 6 ms) grew ${n} polyps in ${dt.toFixed(1)} ms`);
  ok(dt < 6 + 25 && n > 0, 'step keeps to its time budget', dt);
  ok(bleachLevel(27) === 0 && bleachLevel(32) === 1 && bleachLevel(30.5) > 0.3 && bleachLevel(30.5) < 0.7, 'bleach level is 0 cool, 1 hot');
  r.env.temp = 32; const c0 = r.count;
  ok(r.step(100, 6, 1) === 0 && r.count === c0, 'a bleached reef does not grow');
  r.env.temp = 27; ok(r.step(100, 6, 2) > 0, 'cool water: growth starts again');
}

// ── colour ──────────────────────────────────────────────────────────────────
{
  const r = growPreset('mixed', 4, { capTotal: 5000 });
  const n = r.count, F = fieldsOf(r);
  for (const m of MODE_IDS) {
    const t = colourT(r, m);
    let lo = Infinity, hi = -Infinity; for (let i = 0; i < n; i++) { lo = Math.min(lo, t[i]); hi = Math.max(hi, t[i]); }
    ok(lo >= 0 && hi <= 1 + 1e-6 && Number.isFinite(lo), `colour ${m}: t in 0..1`, `${lo} ${hi}`);
  }
  const age = colourT(r, 'age'); let mono = true; for (let i = 1; i < n; i++) if (age[i] < age[i - 1]) mono = false;
  ok(mono && age[n - 1] === 1, 'age: the newest polyp is at the hot end');
  const dep = colourT(r, 'depth'), flow = colourT(r, 'flow'), col = colourT(r, 'colony'), hgt = colourT(r, 'height');
  const seeds = r.colonies.map(c => c.ids[0]);
  ok(seeds.every(g => dep[g] === 0), 'depth: seeds are 0');
  ok(seeds.every(g => Math.abs(flow[g] - 1) < 1e-6), 'flow: seeds (whole colony subtree) are 1');
  let tipFlow = 0, tips = 0; for (let i = 0; i < n; i++) if (F.sub[i] === 1) { tipFlow += flow[i]; tips++; }
  ok(tips > 0 && tipFlow === 0, 'flow: tips are 0');
  ok(r.colonies.every(c => c.ids.every(g => col[g] === col[c.ids[0]])), 'colony: one t per colony');
  ok(new Set(seeds.map(g => col[g].toFixed(4))).size === r.colonies.length, 'colony: each colony a different t');
  ok(Math.abs(Math.max(...hgt.subarray(0, n)) - 1) < 1e-6, 'height: the top polyp is 1');
  const nat = naturalRGB(r); let natOk = true; for (let i = 0; i < n * 3; i++) if (!(nat[i] >= 0 && nat[i] <= 1)) natOk = false;
  ok(natOk, 'natural colours are in 0..1');
  const d = polypData(r, 'flow', 'viridis'), c = sample('viridis', d.t[7]);
  ok(d.n === n && d.pos.length === n * 3 && d.radius.every(v => v > 0), 'polypData: positions and radii');
  ok(Math.abs(d.rgb[21] - c[0]) < 1e-6 && Math.abs(d.rgb[23] - c[2]) < 1e-6, 'polypData: the rgb is the gradient sample of t');
  ok(MODES[0].id === 'natural' && MODES.length === 7, 'seven colour modes, natural first');
}

// ── saver ───────────────────────────────────────────────────────────────────
{
  const a = shotList(42, 30), b = shotList(42, 30), c = shotList(43, 30);
  ok(JSON.stringify(a) === JSON.stringify(b), 'shot list: the same seed gives the same shots');
  ok(JSON.stringify(a) !== JSON.stringify(c), 'shot list: another seed gives other shots');
  ok(a.every(s => s.hold >= 5 && s.hold <= 12), 'shot list: each shot holds 5 to 12 s');
  ok(a.every(s => PRESET_IDS.includes(s.preset) && SPECIES_IDS.includes(s.species) && GRADIENTS[s.gradient] && MODE_IDS.includes(s.mode)), 'shot list: valid presets, species, gradients and modes');
  ok(a.every((s, i) => i === 0 || (s.preset !== a[i - 1].preset && s.mode !== a[i - 1].mode)), 'shot list: no preset or mode twice in a row');
  ok(new Set(a.map(s => s.seed)).size === a.length, 'shot list: every shot grows from a new seed');
  ok(a.some(s => s.kind === 'colony') && a.some(s => s.kind === 'reef'), 'shot list: reef shots and colony shots');
  ok(a.every(s => Math.abs(s.spin) < 0.07 && s.elev > 0.15 && s.elev < 0.5), 'shot list: calm camera moves');
  ok(SAVER_GRADIENTS.every(g => GRADIENTS[g]), 'saver gradients exist');

  const R = PRESETS.mixed.R + 18;
  for (const [w, h, name] of [[1920, 1080, '16:9'], [1080, 1920, '9:16'], [390, 844, 'phone 9:19.5']]) {
    for (const band of [null, { t: 0.2 * h, b: 0.26 * h }, { t: 0.4 * h, b: 0.3 * h }]) {
      const clear = band ? { t: band.t, b: band.b } : {};
      const fit = frameFit({ w, h, clear, radius: R, fov: 40 });
      const box = projectedBox({ w, h, fov: 40 }, fit, R);
      const t = clear.t || 0, bb = clear.b || 0;
      const inside = box.y0 >= t - 0.5 && box.y1 <= h - bb + 0.5 && box.x0 >= -0.5 && box.x1 <= w + 0.5;
      const centred = Math.abs((box.y0 + box.y1) / 2 - (t + (h - t - bb) / 2)) < 0.5 && Math.abs((box.x0 + box.x1) / 2 - w / 2) < 0.5;
      const full = Math.max((box.y1 - box.y0) / (h - t - bb), (box.x1 - box.x0) / w);
      ok(inside && centred, `framing ${name} band ${band ? `${(band.t / h).toFixed(2)}/${(band.b / h).toFixed(2)}` : 'none'}: the reef is in the clear band and centred`, JSON.stringify(box));
      ok(full > 0.7 && full < 0.9, `framing ${name}: the reef fills the band (wide, not tiny)`, full.toFixed(3));
    }
  }
  // the reef as a wide, low ellipse (rx, ry), as main.js frames it
  for (const [w, h, name] of [[1920, 1080, '16:9'], [1080, 1920, '9:16']]) {
    const clear = { t: 0.22 * h, b: 0.27 * h }, rx = R, ry = 0.62 * R;
    const fit = frameFit({ w, h, clear, rx, ry, fov: 40 }), box = projectedBox({ w, h, fov: 40 }, fit, undefined, rx, ry);
    const inside = box.y0 >= clear.t - 0.5 && box.y1 <= h - clear.b + 0.5 && box.x0 >= -0.5 && box.x1 <= w + 0.5;
    const full = Math.max((box.y1 - box.y0) / (h - clear.t - clear.b), (box.x1 - box.x0) / w);
    ok(inside && Math.abs(full - 0.84) < 0.01, `framing ${name} ellipse: inside the band, 84% of the tighter side`, `${JSON.stringify(box)} ${full.toFixed(3)}`);
    console.log(`framing ${name} ellipse rx ${rx} ry ${ry.toFixed(1)}: distance ${fit.dist.toFixed(1)}, box y ${box.y0.toFixed(0)}..${box.y1.toFixed(0)} of band ${clear.t.toFixed(0)}..${(h - clear.b).toFixed(0)}, x ${box.x0.toFixed(0)}..${box.x1.toFixed(0)} of ${w}`);
  }
  const side = frameFit({ w: 1400, h: 900, clear: { l: 300 }, radius: R });
  ok(Math.abs((900 / 2 - side.oy) - 450) < 1e-9 && Math.abs((1400 / 2 - side.ox) - (300 + 550)) < 1e-9, 'framing: a left panel moves the reef to the centre of the clear part');
  console.log(`framing: 16:9 with a 0.20/0.26 band: distance ${frameFit({ w: 1920, h: 1080, clear: { t: 216, b: 281 }, radius: R }).dist.toFixed(1)}; 9:16: ${frameFit({ w: 1080, h: 1920, clear: { t: 384, b: 499 }, radius: R }).dist.toFixed(1)}`);
}

// ── hook source for the saver code extract ──────────────────────────────────
{
  for (const id of SPECIES_IDS) {
    const h = speciesHook(id), src = h.fn.toString();
    ok(typeof h.fn === 'function' && (src.includes(h.name) || src.startsWith('function snowMotion')) && src.length > 60 && src.split('\n').length <= 14, `${id}: hook extract ${h.name} (${src.split('\n').length} lines)`);
  }
  ok(speciesHook('fan', 'motionVector').fn.toString().includes('normal'), 'fan extract keeps the walk in the plane');
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
