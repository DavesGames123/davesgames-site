// ============================================================================
//  OCTANE NUMBER  ·  tests.mjs — node tests, no browser
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/octane-number/tests.mjs
//  knock.js   the volume against closed forms, the delay correlation at a
//             hand-worked point, and the trends that the page claims:
//             more octane, less compression, less spark, less boost and
//             more speed each lower the octane needed.
//  hchem.js   the C-H site counts of heptane, iso-octane, toluene and
//             ethanol, counted by hand from their formulas.
//  data.js    the reference fuels are 0 and 100, every fuel has a record
//             in data/fuels.json, every cited source exists.
//  shots.js   the seeded plan and the framing inside the plate band.
//  draw.js    every figure drawn into a recording 2D context: no throw,
//             no NaN or infinite number reaches the context.
//  page       main.js links in node (a SyntaxError blanks the page),
//             index.html has every id main.js binds, the head load order
//             and the [hidden] guard.
//
//  grep -n targets: "section(" opens each group.
// ============================================================================
import * as K from './knock.js';
import * as Hc from './hchem.js';
import * as D from './draw.js';
import * as Sh from './shots.js';
import { FUELS, SOURCES, HISTORY, ISOMERS_C8, GASOLINES } from './data.js';
import { decode } from '../molecules/chem.js';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const HERE = fileURLToPath(new URL('.', import.meta.url));

let pass = 0, fail = 0, cur = '';
function section(s) { cur = s; console.log('\n# ' + s); }
function ok(c, msg) { if (c) pass++; else { fail++; console.log(`  FAIL [${cur}] ${msg}`); } }
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const recs = JSON.parse(readFileSync(HERE + 'data/fuels.json', 'utf8')).m;
const model = id => decode(recs.find(r => r.id === id));

section('knock.js geometry and delay');
{
  const E = K.ENGINE, A = Math.PI * E.bore ** 2 / 4, Vd = A * E.stroke;
  for (const cr of [8, 10.5, 14]) {
    ok(rel(K.volume(180, cr) / K.volume(0, cr), cr) < 1e-9, `V(BDC)/V(TDC) = ${cr}`);
    ok(rel(K.volume(180, cr) - K.volume(0, cr), Vd) < 1e-9, `swept volume at ${cr}`);
  }
  ok(K.pistonDrop(0) < 1e-12 && rel(K.pistonDrop(180), E.stroke) < 1e-9, 'piston drop 0 at TDC, one stroke at BDC');
  // hand value: ON 100, 1 atm, 1000 K -> 17.68 * e^3.8 ms
  ok(rel(K.delayMs(100, 101325, 1000), 17.68 * Math.exp(3.8)) < 1e-12, 'Douaud-Eyzat at ON 100, 1 atm, 1000 K');
  ok(rel(K.delayMs(50, 101325, 1000) / K.delayMs(100, 101325, 1000), Math.pow(0.5, 3.402)) < 1e-12, 'delay scales as ON^3.402');
  ok(rel(K.delayMs(100, 2 * 101325, 1000) / K.delayMs(100, 101325, 1000), Math.pow(2, -1.7)) < 1e-12, 'delay scales as p^-1.7');
  const hz = K.ringHz(2500);
  ok(hz > 5000 && hz < 8000, `ring of the 86 mm bore at 2500 K: ${hz.toFixed(0)} Hz`);
}

section('knock.js cycle');
{
  const d = K.defaults();
  const c = K.cycle(d);
  ok(!c.knock, 'the default engine on its default fuel does not knock');
  ok(c.pmax / 1e5 > 35 && c.pmax / 1e5 < 80, `peak pressure ${(c.pmax / 1e5).toFixed(1)} bar is a full-load value`);
  ok(c.thPmax > 5 && c.thPmax < 25, `peak pressure ${c.thPmax}° after top centre`);
  ok(c.imep / 1e5 > 7 && c.imep / 1e5 < 14, `IMEP ${(c.imep / 1e5).toFixed(2)} bar`);
  ok(c.xb[0] === 0 && c.xb[c.xb.length - 1] > 0.99, 'burn goes from 0 to 1');
  for (let i = 1; i < c.I.length; i++) if (c.I[i] < c.I[i - 1]) { ok(false, 'knock integral never falls'); break; }
  const req = K.requiredON(d);
  ok(req > 85 && req < 98, `octane needed at 10.5:1, 2000 rpm, full load: ${req.toFixed(1)} (page text says about 91)`);
  ok(!!K.cycle({ ...d, on: req - 1 }).knock && !K.cycle({ ...d, on: req + 0.5 }).knock, 'requiredON is the knock edge');
  const kn = K.cycle({ ...d, on: 80 });
  ok(kn.knock && kn.knock.th > -d.spark && kn.knock.unburned > 0 && kn.knock.unburned < 1, 'ON 80 knocks after the spark with end gas left');
  ok(Math.abs(K.pressureAt(kn, kn.knock.th + 0.6) - K.pressureAt({ ...kn, knock: null }, kn.knock.th + 0.6)) > 1e5, 'the ring moves the pressure by over 1 bar');
  ok(K.pressureAt(c, 0) === c.p0[c.th.indexOf(0)], 'pressureAt matches the cycle on whole degrees');
  // the trends of the page text
  ok(K.requiredON({ ...d, cr: 12 }) > K.requiredON({ ...d, cr: 9 }), 'more compression needs more octane');
  ok(K.requiredON({ ...d, spark: 30 }) > K.requiredON({ ...d, spark: 10 }), 'more spark advance needs more octane');
  ok(K.requiredON({ ...d, boost: 1.5 }) > K.requiredON({ ...d, boost: 1.0 }), 'boost needs more octane');
  ok(K.requiredON({ ...d, rpm: 1100 }) > K.requiredON({ ...d, rpm: 4000 }), 'a slow engine needs more octane');
  ok(K.knockLimitedSpark({ ...d, on: 100 }) > K.knockLimitedSpark({ ...d, on: 85 }), 'more octane allows more spark advance');
  // the bracketing test: critical compression rises with octane
  const r = [50, 70, 90, 100, 110].map(on => K.criticalCR({ ...K.RATING.ron, on }));
  ok(r.every((v, i) => i === 0 || v > r[i - 1]), `critical compression ratio rises with octane: ${r.map(v => v.toFixed(2)).join(' ')}`);
  ok(K.criticalCR({ ...K.RATING.mon, on: 90 }) < K.criticalCR({ ...K.RATING.ron, on: 90 }), 'the Motor conditions knock at a lower compression');
  // the page presets do what their names say
  ok(!K.cycle({ on: 95, cr: 10.5, spark: 22, boost: 1, rpm: 2000 }).knock, 'preset "Clean burn" does not knock');
  for (const [n, p] of [['Knocking', { on: 80, cr: 10.5, spark: 26, boost: 1, rpm: 2000 }], ['Turbo, low octane', { on: 91, cr: 9.5, spark: 20, boost: 1.6, rpm: 2500 }], ['Lugging', { on: 91, cr: 10.5, spark: 22, boost: 1, rpm: 1100 }]])
    ok(!!K.cycle(p).knock, `preset "${n}" knocks`);
  for (const kc of Sh.KNOCK_CASES) ok(!!K.cycle(kc).knock === kc.knock, `saver case ON ${kc.on} ${kc.knock ? 'knocks' : 'is clean'}`);
}

section('hchem.js C-H sites');
{
  const s = id => Hc.sites(model(id)).count;
  const hep = s('heptane'), iso = s('isooctane'), tol = s('toluene'), eth = s('ethanol');
  ok(hep.primary === 6 && hep.secondary === 10 && hep.tertiary === 0, 'heptane: 2 CH3 + 5 CH2');
  ok(iso.primary === 15 && iso.secondary === 2 && iso.tertiary === 1, 'iso-octane: 5 CH3 + 1 CH2 + 1 CH');
  ok(tol.aromatic === 5 && tol.benzylic === 3, 'toluene: 5 ring H + 3 next to the ring');
  ok(eth.primary === 3 && eth.alphaO === 2 && eth.hydroxyl === 1, 'ethanol: CH3, CH2 next to O, OH');
  ok(Hc.chainRun(model('octane')) === 6 && Hc.chainRun(model('heptane')) === 5 && Hc.chainRun(model('isooctane')) === 1, 'longest CH2 runs: octane 6, heptane 5, iso-octane 1');
  ok(Hc.shifts(model('heptane')).easy > Hc.shifts(model('isooctane')).easy, 'heptane has more easy H-shift paths than iso-octane');
  for (const f of FUELS) { const M = model(f.id), si = Hc.sites(M); ok(si.total === Array.from(M.z).filter(z => z === 1).length, `${f.id}: every H has a class`); }
}

section('data.js');
{
  const by = id => FUELS.find(f => f.id === id);
  ok(by('heptane').ron === 0 && by('heptane').mon === 0 && by('isooctane').ron === 100 && by('isooctane').mon === 100, 'the reference fuels are 0 and 100');
  for (const f of FUELS) ok(recs.some(r => r.id === f.id), `${f.id} has a 3D record`);
  ok(recs.length === FUELS.length, 'fuels.json holds exactly the page fuels');
  const c8 = ISOMERS_C8.map(id => recs.find(r => r.id === id).f);
  ok(c8.every(f => f === 'C8H18'), 'the four isomers are all C8H18');
  for (const h of HISTORY) for (const s of h.src) ok(SOURCES[s], `history ${h.year} cites ${s}`);
  for (const g of GASOLINES) ok(g.ron > g.mon, `${g.name}: RON above MON`);
  const html = readFileSync(HERE + 'index.html', 'utf8');
  ok(/RON of about 91.5/.test(readFileSync(HERE + 'main.js', 'utf8')) && GASOLINES[0].ron === 91.5, 'the pump-regular sample agrees with the table');
  ok(html.includes('about 91 octane'), 'the source note states the calibration');
}

section('shots.js');
{
  const a = Sh.shotPlan(7), b = Sh.shotPlan(7), c = Sh.shotPlan(8);
  ok(JSON.stringify(a) === JSON.stringify(b), 'same seed, same plan');
  ok(JSON.stringify(a) !== JSON.stringify(c), 'another seed, another plan');
  ok(a.every((s, i) => i === 0 || s.id !== a[i - 1].id), 'no shot repeats back to back');
  ok(a.every(s => s.sec >= 7 && s.sec <= 14), 'shots last 7 to 14 s');
  ok(new Set(a.filter(s => s.id === 'knock').slice(0, 4).map(s => s.kcase)).size === 4, 'the knock shots go through all four cases');
  for (const [w, h] of [[1280, 800], [450, 800]]) for (const id of Sh.SHOT_IDS) {
    const band = { t: 0.2 * h, b: 0.25 * h }, L = Sh.shotLayout(id, w, h, band);
    ok(L.panels.every(p => p.y >= band.t && p.y + p.h <= h - band.b + 0.5 && p.x >= 0 && p.x + p.w <= w + 0.5 && p.w > 50 && p.h > 50), `${id} at ${w}x${h} sits in the band`);
  }
}

section('draw.js into a recording context');
{
  const bad = [];
  const ctx = () => {
    const g = new Proxy({}, {
      get(t, k) {
        if (k === 'measureText') return s => ({ width: String(s).length * 6 });
        if (k in t) return t[k];
        if (/^create(Linear|Radial)Gradient$/.test(k)) return (...a) => { if (a.some(v => !Number.isFinite(v))) bad.push(`${k}(${a.join(',')})`); return { addColorStop: (o) => { if (!(o >= 0 && o <= 1)) bad.push(`addColorStop(${o})`); } }; };
        return (...a) => { if (a.some(v => typeof v === 'number' && !Number.isFinite(v))) bad.push(`${String(k)}(${a.join(',')})`); };
      },
      set(t, k, v) { t[k] = v; return true; },
    });
    return g;
  };
  globalThis.Path2D = class { rect() {} };
  const d = K.defaults(), c0 = K.cycle(d), c1 = K.cycle({ ...d, on: 78, spark: 26 });
  const run = (name, f) => { try { f(); ok(true, name); } catch (e) { ok(false, `${name} threw ${e.message}`); } };
  for (const [w, h] of [[640, 340], [150, 240]]) {
    run(`blend ${w}`, () => D.drawBlend(ctx(), w, h, { frac: 0.91, t: 3 }));
    run(`meter ${w}`, () => D.drawMeter(ctx(), w, h, { sample: { name: 'Pump regular', ccr: 7.9 }, blend: { on: 91, ccr: 7.9 } }));
    for (const c of [c0, c1]) for (const th of [-140, -30, 0, 12, 40, 130]) {
      run(`cylinder ${w} ${th}`, () => D.drawCylinder(ctx(), w, h, { c, th, E: K.ENGINE, drop: t => K.pistonDrop(t) }));
      run(`pressure ${w} ${th}`, () => D.drawPressure(ctx(), w, h, { c, th, pressureAt: K.pressureAt }));
    }
    run(`required ${w}`, () => D.drawRequired(ctx(), w, h, { curves: [{ rpm: 2000, pts: [[7, 70], [10, 100], [15, null]] }], cur: { cr: 10.5, on: 91 }, fuelOn: 95 }));
    run(`spark ${w}`, () => D.drawSpark(ctx(), w, h, { pts: Array.from({ length: 46 }, (_, s) => ({ spark: s, imep: 9 + Math.sin(s / 10), knock: s > 30 })), cur: { spark: 22, imep: 9.5, knock: false } }));
    run(`ladder ${w}`, () => D.drawLadder(ctx(), w, h, { fuels: FUELS, sel: 'heptane', hover: 'toluene', c8: ISOMERS_C8 }));
    for (let s = 0; s < D.MECH_STEPS.length; s++) for (const k of [0, 0.5, 1]) run(`mech ${w} ${s} ${k}`, () => D.drawMech(ctx(), w, h, { step: s, k }));
    run(`shift ${w}`, () => D.drawShift(ctx(), w, h, { pts: [{ id: 'heptane', name: 'n-Heptane', fam: 'straight', x: 1.75, y: 0 }], sel: 'heptane' }));
    run(`ron-mon ${w}`, () => D.drawRonMon(ctx(), w, h, { fuels: FUELS, gas: GASOLINES, sel: 'ethanol' }));
  }
  ok(!bad.length, 'no NaN or infinite value reached the context' + (bad.length ? ': ' + bad.slice(0, 5).join(' | ') : ''));
}

section('page');
{
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./main.js')"], { cwd: HERE, encoding: 'utf8', timeout: 60000 });
  const err = run.stderr || '';
  ok(!/SyntaxError/.test(err), 'main.js links (no SyntaxError)' + (/SyntaxError/.test(err) ? ': ' + err.split('\n').find(l => /SyntaxError/.test(l)) : ''));
  ok(/ReferenceError: (matchMedia|window|document|IntersectionObserver|addEventListener|requestAnimationFrame) is not defined/.test(err), 'main.js ran in node until a browser global');
  const html = readFileSync(HERE + 'index.html', 'utf8'), js = readFileSync(HERE + 'main.js', 'utf8'), css = readFileSync(HERE + 'style.css', 'utf8');
  const ids = [...new Set([...js.matchAll(/\$\('([A-Za-z0-9]+)'\)/g)].map(m => m[1]))];
  const dyn = ['onIn', 'crIn', 'sparkIn', 'boostIn', 'rpmIn', 'onOut', 'crOut', 'sparkOut', 'boostOut', 'rpmOut'];
  const missing = [...ids, ...dyn].filter(id => !html.includes(`id="${id}"`));
  ok(ids.length > 25 && !missing.length, `index.html has all ${ids.length + dyn.length} ids main.js binds` + (missing.length ? ` (missing ${missing.join(', ')})` : ''));
  const head = html.slice(0, html.indexOf('</head>'));
  const i1 = head.indexOf('gpu-guard.js'), i2 = head.indexOf('wishlist.js'), i3 = head.indexOf('stats-beacon.js');
  ok(i1 > 0 && i1 < i2 && i2 < i3, 'head loads gpu-guard, wishlist, stats-beacon in order');
  ok(css.includes('[hidden]{display:none!important}'), 'style.css has the [hidden] guard');
  ok(js.includes("import './saver.js'"), 'main.js imports saver.js');
  ok(html.indexOf('type="importmap"') < html.indexOf('src="main.js"'), 'the importmap comes before main.js');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
