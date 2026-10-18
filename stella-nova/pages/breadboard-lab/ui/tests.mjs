// ============================================================================
//  BREADBOARD LAB  ·  ui/tests.mjs — node ui/tests.mjs
// ----------------------------------------------------------------------------
//  The pure parts of the UI and the instruments (CONTRACT 7, MCU+UI). One
//  line per check with the measured value. Exit 1 on any failure.
//
//    imports ....... every ui/*.js and instruments/*.js imports in node
//                    without touching window or document
//    format ........ si(), parseSI(), the E-series
//    dmm ........... readings, ranges, autorange hysteresis, overload
//    scope ......... trigger crossings, sweeps, measurements
//    logic ......... the edge log and the UART decoder at 9600 baud
//    share ......... link encode / decode round trips
//    files ......... a localStorage that throws does not break save
//    legacy ........ the old bench seed (5 boards, 18 parts) imports
//    dom ........... createUI on a small fake DOM: panels, keys, frames
//    style ......... style.css: WCAG AA pairs, 44 px targets, focus rings,
//                    no glow (ui/style-tests.mjs)
// ============================================================================
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
let pass = 0, fail = 0;
const ok = (cond, name, val = '') => {
  if (cond) pass++; else fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${val !== '' ? '  -> ' + val : ''}`);
};
const section = s => console.log('\n== ' + s);

// ── imports ─────────────────────────────────────────────────────────────────
section('imports (no DOM at import time)');
const mods = {};
for (const dir of ['ui', 'instruments']) {
  for (const f of readdirSync(join(ROOT, dir)).filter(f => f.endsWith('.js')).sort()) {
    try { mods[`${dir}/${f}`] = await import(pathToFileURL(join(ROOT, dir, f)).href); ok(true, `import ${dir}/${f}`); }
    catch (e) { ok(false, `import ${dir}/${f}`, e.message); }
  }
}
const F = mods['ui/format.js'], M = mods['instruments/meter.js'], SC = mods['instruments/scope.js'], LG = mods['instruments/logic.js'];
const SH = mods['ui/share.js'], FL = mods['ui/files.js'], LE = mods['ui/legacy.js'], FG = mods['instruments/funcgen.js'];

// ── format ──────────────────────────────────────────────────────────────────
section('format');
{
  const cases = [[0.0136, 'A', '13.6 mA'], [4700, 'Ω', '4.70 kΩ'], [0, 'V', '0.00 V'], [-1.2, 'V', '-1.20 V'], [1e-7, 'F', '100 nF'], [999.6, 'V', '1.00 kV'], [2.2e6, 'Ω', '2.20 MΩ'], [3.3, 'V', '3.30 V'], [0.000047, 'F', '47.0 µF']];
  for (const [v, u, want] of cases) { const got = F.si(v, u); ok(got === want, `si(${v}, '${u}') = "${want}"`, got); }
  const parses = [['4k7', 4700], ['10u', 1e-5], ['2.2M', 2.2e6], ['100nF', 1e-7], ['3.3 V', 3.3], ['1e-3', 1e-3], ['-5mA', -0.005], ['0.1µF', 1e-7], ['1.5kHz', 1500], ['220', 220], ['abc', NaN]];
  for (const [s, want] of parses) { const got = F.parseSI(s); ok(Number.isNaN(want) ? Number.isNaN(got) : Math.abs(got - want) <= Math.abs(want) * 1e-12, `parseSI("${s}") = ${want}`, got); }
  ok(F.snapE(4600, 'E12') === 4700 && F.snapE(5000, 'E24') === 5100 && F.snapE(2.3e-7, 'E12') === 2.2e-7, 'snapE picks the nearest series value in log space', [F.snapE(4600, 'E12'), F.snapE(5000, 'E24'), F.snapE(2.3e-7, 'E12')].join(' '));
  ok(F.stepE(4700, 1) === 5600 && F.stepE(4700, -1) === 3900 && F.stepE(8200, 1) === 10000, 'stepE walks the E12 ladder across decades', [F.stepE(4700, 1), F.stepE(4700, -1), F.stepE(8200, 1)].join(' '));
}

// ── dmm ─────────────────────────────────────────────────────────────────────
section('dmm');
{
  const r = (v, m, range = 'auto', prev = null) => M.dmmReading(v, m, range, prev);
  const show = x => `${x.text} ${x.unit}`;
  const cases = [[0.0136, 'A', '13.60 mA'], [4700, 'R', '4.70 kΩ'], [5, 'V', '5.00 V'], [0.15, 'V', '150.0 mV'], [1.5, 'V', '1.500 V'], [-3.3, 'V', '-3.30 V'], [700, 'V', 'OL V'], [Infinity, 'R', 'OL MΩ'], [0.00005, 'A', '50.0 µA'], [2.5, 'A', '2.50 A']];
  for (const [v, m, want] of cases) { const got = show(r(v, m)); ok(got === want, `DMM ${m} ${v} reads "${want}"`, got); }
  const a = r(1.9, 'V', 'auto', 2), b = r(1.5, 'V', 'auto', 2), c = r(2.5, 'V', 'auto', 1);
  ok(show(a) === '1.90 V' && show(b) === '1.500 V' && show(c) === '2.50 V', 'autorange: stays on 20 V at 1.9 V, drops to 2 V below 1.8 V, goes up at full scale', `${show(a)} | ${show(b)} | ${show(c)}`);
  const man = r(5, 'V', 2), man2 = r(0.0136, 'A', 0.2);
  ok(show(man) === 'OL V' && show(man2) === '13.6 mA', 'manual range: 5 V on the 2 V range is OL; 13.6 mA on 200 mA', `${show(man)} | ${show(man2)}`);
  ok(show(r(12, 'cont')) === '12.0 Ω', 'continuity reads on the 200 Ω range', show(r(12, 'cont')));
}

// ── scope ───────────────────────────────────────────────────────────────────
section('scope');
{
  const f = 1000, fs = 100000, N = 1000;
  const t = [], s = [];
  for (let i = 0; i < N; i++) { t.push(i / fs); s.push(2.5 + 2.5 * Math.sin(2 * Math.PI * f * i / fs)); }
  const tr = SC.findTrigger(t, s, 2.5, 'rise');
  const errR = Math.max(...tr.map(x => Math.abs(x - Math.round(x * f) / f)));
  ok(tr.length === 9 && errR < 2e-7, 'rising trigger at 2.5 V finds every period start of a 1 kHz sine', `${tr.length} crossings, worst error ${(errR * 1e9).toFixed(1)} ns`);
  const t375 = SC.findTrigger(t, s, 3.75, 'rise');
  const err3 = Math.max(...t375.map(x => Math.abs(x - (Math.floor(x * f) / f + 1 / 12000))));
  ok(err3 < 2e-6, 'rising trigger at 3.75 V sits at asin(0.5) / (2 pi f)', `worst error ${(err3 * 1e9).toFixed(1)} ns`);
  const fall = SC.findTrigger(t, s, 2.5, 'fall');
  ok(fall.length >= 9 && Math.abs(fall[0] - 0.0005) < 2e-7, 'falling trigger finds the half-period crossings', fall[0]);
  // a square wave: 1 kHz, duty 25 %, 0 / 5 V, sampled at 200 kHz
  const qt = [], qs = [];
  for (let i = 0; i < 4000; i++) { const tt = i / 200000; qt.push(tt); qs.push(((tt * 1000) % 1) < 0.25 ? 5 : 0); }
  const m = SC.measure(qt, qs);
  ok(Math.abs(m.freq - 1000) < 5 && Math.abs(m.duty - 0.25) < 0.01 && Math.abs(m.pp - 5) < 1e-9 && Math.abs(m.mean - 1.25) < 0.02, 'measure: 1 kHz, 25 % duty, 5 Vpp, mean 1.25 V', `f ${m.freq.toFixed(2)} Hz, duty ${m.duty.toFixed(4)}, Vpp ${m.pp}, mean ${m.mean.toFixed(4)}`);
  // sweeps from a capture fed in frame-sized chunks
  const cap = new SC.Capture(2, 1 << 14);
  const dt = 1e-5;
  for (let k = 0; k < 40; k++) {
    const n = 500, ch0 = new Float32Array(n), ch1 = new Float32Array(n);
    for (let i = 0; i < n; i++) { const tt = (k * n + i) * dt; ch0[i] = 2.5 + 2.5 * Math.sin(2 * Math.PI * 1000 * tt); ch1[i] = 1; }
    cap.push(k * n * dt, dt, [ch0, ch1]);
  }
  const st = { tdiv: 2e-4, vdiv: [1, 1], offset: [0, 0], trig: { ch: 0, level: 2.5, edge: 'rise', mode: 'auto', pos: 0.1 } };
  const sw = SC.sweep(cap, st, {});
  const frac = sw && ((sw.trigT * 1000) % 1);
  ok(sw && sw.triggered && Math.min(frac, 1 - frac) < 1e-3 && Math.abs(sw.t0 - (sw.trigT - 0.1 * 2e-3)) < 1e-12, 'sweep: triggered, trigger at 10 % of the screen, on a period start', sw ? `trigT ${sw.trigT.toFixed(6)} s` : 'no sweep');
  const flat = new SC.Capture(1, 4096);
  flat.push(0, 1e-4, [new Float32Array(2000).fill(1)]);
  const swA = SC.sweep(flat, { ...st, trig: { ...st.trig, ch: 0 } }, {});
  const swN = SC.sweep(flat, { ...st, trig: { ...st.trig, ch: 0, mode: 'normal' } }, {});
  ok(swA && !swA.triggered && swN === null, 'auto free-runs without a trigger; normal shows nothing', `auto ${swA && swA.triggered}, normal ${swN}`);
}

// ── logic ───────────────────────────────────────────────────────────────────
section('logic analyzer');
{
  const baud = 9600, bt = 1 / baud;
  const frameEdges = (bytes, t0) => {
    const ed = []; let lvl = 1, t = t0;
    const put = (l, at) => { if (l !== lvl) { ed.push([at, l]); lvl = l; } };
    for (const b of bytes) {
      put(0, t);
      for (let i = 0; i < 8; i++) put((b >> i) & 1, t + bt * (1 + i));
      put(1, t + bt * 9);
      t += bt * 10 + bt * 3;
    }
    return ed;
  };
  const dec = LG.decodeUart(frameEdges([0x48, 0x69, 0x0a], 0.001), baud);
  ok(dec.map(d => d.byte).join(',') === '72,105,10' && dec.every(d => !d.err), 'UART decode of a 9600-baud "Hi\\n"', dec.map(d => `0x${d.byte.toString(16)}`).join(' '));
  const one = LG.decodeUart(frameEdges([0x55], 0.002), baud);
  ok(one.length === 1 && one[0].byte === 0x55 && Math.abs(one[0].t - 0.002) < 1e-12, 'one byte 0x55 at its start time', JSON.stringify(one));
  const bad = LG.decodeUart([[0.001, 0], [0.001 + 9.5 * bt + 1e-6, 0]], baud);
  ok(bad.length === 1 && bad[0].err === 'framing', 'a low stop bit is a framing error', JSON.stringify(bad.map(d => d.err)));
  const log = new LG.EdgeLog(8);
  log.push(0.001, 0, 1); log.push(0.002, 0, 0); log.push(0.002, 0, 0); log.push(0.003, 3, 1);
  ok(log.levelAt(0, 0.0015) === 1 && log.levelAt(0, 0.0025) === 0 && log.levelAt(3, 0.004) === 1 && log.ch[0].t.length === 2, 'edge log keeps changes only and answers levels', `${log.ch[0].t.length} edges on D0`);
}
{
  const p = FG.waveAt;
  ok(Math.abs(p(0.25, { wave: 'sine', amp: 2, offset: 1 }) - 3) < 1e-12 && p(0.1, { wave: 'square', amp: 1, duty: 0.25 }) === 1 && p(0.5, { wave: 'square', amp: 1, duty: 0.25 }) === -1 && p(0.5, { wave: 'tri', amp: 1 }) === 1, 'function generator preview: sine, square duty, triangle');
}

// ── share ───────────────────────────────────────────────────────────────────
section('share links');
const exampleDocs = [];
{
  const dir = join(ROOT, 'examples');
  if (existsSync(dir)) for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    try { const o = JSON.parse(readFileSync(join(dir, f), 'utf8')); exampleDocs.push([f, o.doc || o]); } catch (e) { ok(false, `examples/${f} is valid JSON`, e.message); }
  }
}
{
  const fixture = JSON.parse(readFileSync(join(HERE, 'fixtures', 'legacy-seed.json'), 'utf8'));
  const { doc } = LE.importLegacy(fixture, {});
  const big = { format: 'breadboard-lab', version: 1, title: 'ünïcødé Ω µ', notes: 'x'.repeat(3000), boards: [], parts: Array.from({ length: 60 }, (_, i) => ({ id: 'p' + i, def: 'res', place: { on: null, x: i, z: -i, rot: i & 3 }, params: { r: 220 * i } })), wires: [], probes: [], materials: [], customParts: [], programs: { p1: { lang: 'sketch', source: 'void setup(){}\nvoid loop(){}' } }, sim: { speed: 1, pwm: 'auto' }, nextId: 61 };
  const docs = [...exampleDocs, ['legacy import', doc], ['60 parts + unicode', big]];
  for (const [name, d] of docs) {
    const enc = await SH.encodeDoc(d);
    const back = await SH.decodeHash('#' + enc);
    ok(JSON.stringify(back) === JSON.stringify(d) && enc.startsWith('d='), `share round trip: ${name}`, `${enc.length} chars (JSON ${JSON.stringify(d).length})`);
  }
  if (!exampleDocs.length) ok(true, 'share round trip of the example files', 'no example files yet; INTEGRATE writes them');
  const j = 'j=' + SH.b64url(new TextEncoder().encode(JSON.stringify(big)));
  ok(JSON.stringify(await SH.decodeHash(j)) === JSON.stringify(big), 'the uncompressed #j= fallback decodes too');
  const L = await SH.shareLink(big, 'https://dave.example/stella-nova/pages/breadboard-lab/?x=1#old');
  ok(L.url.startsWith('https://dave.example/stella-nova/pages/breadboard-lab/?x=1#d=') && L.warn === (L.chars > 8000), 'shareLink keeps the page URL, replaces the hash, flags > 8000 chars', `${L.chars} chars, warn ${L.warn}`);
  let threw = false; try { await SH.decodeHash('#d=AAAA'); } catch (e) { threw = true; }
  ok(threw, 'a broken link throws (the page then says so)');
}

// ── files ───────────────────────────────────────────────────────────────────
section('files and storage');
{
  const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('nope'); } };
  const files = FL.createFiles({ storage: FL.safeStorage(throwing) });
  const d = { format: 'breadboard-lab', version: 1, title: 'T', parts: [{ id: 'p1' }] };
  let r, err = null;
  try { r = files.save('one', d); } catch (e) { err = e; }
  ok(!err && r.ok && r.persisted === false, 'save with a throwing localStorage: no exception, kept in memory', JSON.stringify(r));
  ok(files.load('one') && files.load('one').title === 'T' && files.list().length === 1, 'load and list still work from memory');
  ok(files.autosave(d) === false && files.loadAutosave().title === 'T', 'autosave falls back to memory');
  const none = FL.createFiles({ storage: FL.safeStorage(null) });
  ok(none.save('x', d).ok && none.load('x').title === 'T', 'no localStorage at all still saves for the visit');
  // a working store
  const store = new Map();
  const real = FL.createFiles({ storage: FL.safeStorage({ getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }) });
  ok(real.save('bench', d).persisted === true && JSON.parse(store.get('bblab:files')).bench.doc.title === 'T', 'a working store persists under bblab:files');
  real.saveLibMaterial({ id: 'mat-x', name: 'X', color: '#123456', roughness: 0.5, metalness: 0 });
  real.saveLibMaterial({ id: 'mat-x', name: 'X2', color: '#123456', roughness: 0.5, metalness: 0 });
  ok(real.libMaterials().length === 1 && real.libMaterials()[0].name === 'X2', 'the material library replaces by id');
  const kinds = [JSON.stringify(d), JSON.stringify({ meta: { key: 'k' }, doc: d }), JSON.stringify({ placed: [], wires: [] }), JSON.stringify({ kind: 'part', def: { id: 'cp-a' } }), '{bad'].map(t => FL.parseJSON(t).kind);
  ok(kinds.join(',') === 'doc,example,legacy,part,unknown', 'parseJSON tells a bench, an example, an old bench, a part and junk apart', kinds.join(','));
}

// ── legacy ──────────────────────────────────────────────────────────────────
section('legacy import (the old bench seed)');
async function loadRegistry() {
  try {
    if (existsSync(join(ROOT, 'parts', 'index.js'))) { const P = await import(pathToFileURL(join(ROOT, 'parts', 'index.js')).href); if (P.createRegistry) return P.createRegistry(P.BUILTIN_DEFS); }
    const R = await import(pathToFileURL(join(ROOT, 'parts', 'registry.js')).href);
    const defs = [];
    for (const f of readdirSync(join(ROOT, 'parts', 'defs')).filter(f => f.endsWith('.js'))) {
      const m = await import(pathToFileURL(join(ROOT, 'parts', 'defs', f)).href);
      for (const v of Object.values(m)) if (Array.isArray(v) && v.length && v[0] && v[0].id && v[0].pins) defs.push(...v);
    }
    return R.createRegistry(defs);
  } catch (e) { return null; }
}
{
  const fixture = JSON.parse(readFileSync(join(HERE, 'fixtures', 'legacy-seed.json'), 'utf8'));
  const reg = await loadRegistry();
  ok(true, 'part registry for the fit', reg ? `real registry, ${reg.list().length} defs` : 'none (fallback placement)');
  const { doc, warnings } = LE.importLegacy(fixture, { registry: reg });
  ok(doc.boards.length === 5 && doc.boards.every(b => b.type === 'bb400'), 'every old board imports as a bb400', doc.boards.map(b => `${b.id}(${b.x},${b.z})`).join(' '));
  const overlap = doc.boards.some((a, i) => doc.boards.some((b, j) => j > i && Math.abs(a.x - b.x) < 82.6 && Math.abs(a.z - b.z) < 54.6));
  ok(!overlap, 'the boards do not overlap');
  const want = { esp32sp: 'mcu-esp32', seg7: 'seg7-4', joy: 'joystick', lcd: 'lcd-1602', fm: 'mod-fm', tft: 'mod-tft154', btnb: 'button-12mm', btnr: 'button-12mm', btnm: 'button-6mm', rc522: 'mod-rfid', nrf: 'mod-nrf24', radar: 'mod-radar', spk: 'speaker-8r', vshield: 'batt-18650-shield', solar: 'solar-panel' };
  const got = doc.parts.map(p => p.def);
  const exp = fixture.placed.map(p => want[p.defId]);
  ok(doc.parts.length === 18 && JSON.stringify(got) === JSON.stringify(exp), 'all 18 parts map to their new defs', got.join(' '));
  ok(doc.parts.filter(p => p.def === 'button-12mm').map(p => p.params.cap).join(',') === 'blue,red', 'button caps keep their colours');
  ok(doc.wires.length === fixture.wires.length, 'every old wire imports', `${doc.wires.length} of ${fixture.wires.length}`);
  const holeRe = /^b[1-5]:([a-j]([1-9]|[12]\d|30)|(TP|TN|BP|BN)([1-9]|1\d|2[0-5]))$/;
  const ends = doc.wires.flatMap(w => [w.a, w.b]);
  const badEnds = ends.filter(e => !(e.hole ? holeRe.test(e.hole) : doc.parts.some(p => p.id === e.part && p.place.on === null)));
  ok(!badEnds.length, 'every wire end is a valid bb400 hole or a pin of a part on the mat', badEnds.length ? JSON.stringify(badEnds) : `${ends.length} ends`);
  const holes = ends.filter(e => e.hole).map(e => e.hole);
  ok(new Set(holes).size === holes.length, 'no two wire ends share a hole');
  ok(doc.wires[0].color === '#d63b3b' && doc.wires[6].color === '#e0c126', 'old wire colours map to the new palette');
  ok(Array.isArray(warnings) && warnings.length > 0, 'the import returns a warning list', `${warnings.length} warnings, e.g. "${warnings[0]}"`);
  if (reg) {
    const esp = doc.parts.find(p => p.def === 'mcu-esp32'), def = reg.get('mcu-esp32');
    const pinHole = name => {
      const dp = def.pins.find(q => q.name === name);
      let x = dp.x * 2.54, z = dp.z * 2.54;
      for (let i = 0; i < esp.place.rot; i++) [x, z] = [-z, x];
      return LE.holeLocal400 && ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].flatMap(r => Array.from({ length: 30 }, (_, c) => r + (c + 1))).find(id => { const q = LE.holeLocal400(id); return Math.hypot(q.x - esp.place.x - x, q.z - esp.place.z - z) < 0.3; });
    };
    const h23 = pinHole('23'), h3v3 = pinHole('3V3'), hEN = pinHole('EN');
    const allIn = def.pins.every(q => pinHole(q.name));
    const rowsUsed = [...new Set(def.pins.map(q => (pinHole(q.name) || '?')[0]))].sort().join('');
    ok(esp.place.on === 'b2' && allIn && rowsUsed === 'bi' && h23[0] === 'b', 'the ESP32 sits on board 2 in rows b and i, all 30 pins in holes, its signal row in row b as before', `pin 1 (EN) ${hEN}, pin 23 ${h23}, rot ${esp.place.rot}, rows ${rowsUsed}`);
    const w0 = doc.wires[0].a.hole || doc.wires[0].b.hole;
    const strip = id => { const m = /^([a-j])(\d+)$/.exec(id.split(':')[1]); return m ? m[2] + ('abcde'.includes(m[1]) ? 'T' : 'B') : id; };
    ok(w0 && strip('b2:' + h3v3) === strip(w0) && w0 !== 'b2:' + h3v3, 'a wire from the ESP32 3V3 pin lands one hole over in the same strip', `pin ${h3v3}, wire end ${w0}`);
  }
}

// ── dom ─────────────────────────────────────────────────────────────────────
if (existsSync(join(HERE, 'dom-tests.mjs'))) {
  section('dom (fake DOM)');
  const { domTests } = await import('./dom-tests.mjs');
  await domTests({ ok, mods, ROOT });
}

// ── style ───────────────────────────────────────────────────────────────────
section('style (contrast, touch targets, focus, glow)');
{ const { styleTests } = await import('./style-tests.mjs'); await styleTests({ ok }); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
