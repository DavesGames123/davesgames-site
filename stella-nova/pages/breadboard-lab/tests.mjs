// ============================================================================
//  BREADBOARD LAB  ·  tests.mjs — the page tests (INTEGRATE, CONTRACT 7)
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/breadboard-lab/tests.mjs [--quick]
//  One line per check with what it measured. Exit 1 on any failure.
//  --quick skips the five role test files (they take most of the time).
//
//  SECTIONS (grep "SECTION:")
//    syntax ......... node --check on every .js and .mjs file of the page
//    imports ........ every module that must import in node (no DOM)
//    markup ......... head order, importmap, the DOM ids of CONTRACT 4.4,
//                     [hidden]{display:none!important}, hidden vs display
//    examples ....... build.mjs --check (no drift), then each example:
//                     normalizeDoc with no repairs, buildNetlist with no
//                     warnings, only its expected issues, a run with no NaN
//                     that meets every meta.check (examples/verify.mjs)
//    saver .......... reel and shot maths; every reel bench fits the clear
//                     band in 16:9, in 9:16, and in a 9:16 column
//    scenarios ...... boot-scenarios.mjs, one boot per process: the saver
//                     gives the bench back, pagehide flushes the autosave,
//                     a link or ?example= opens once, the #nogl text, a
//                     custom part from the autosave, and a jsdom boot at a
//                     desktop and a phone size (needs JSDOM_DIR)
//    boot ........... main.js runs in node on ui/fakedom.mjs: 'three'
//                     resolves to the vendored copy, fetch reads files, the
//                     first example loads, the inline sim sends frames, the
//                     saver hook enters and names a bench, pagehide releases
//    roles .......... sim, parts, view, mcu (+ avr) and ui test files
//    site ........... nav-sync --check, wishlist-check, home tests,
//                     thumbs-list --check (repo tools; only lines about this
//                     page count when other pages are mid-edit)
//
//  GREP MAP
//    check / section .... reporting
//    THREE_HOOK ......... the loader hook for the 'three' importmap names
//    fileFetch .......... fetch for file: URLs in the boot test
//    project ............ screen position of a world point (saver framing)
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '../../..');
const SN = path.join(ROOT, 'stella-nova');
const quick = process.argv.includes('--quick');
let count = 0, fails = 0;
function check(name, ok, measured = '') {
  count++;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${measured !== '' ? ' — ' + measured : ''}`);
}
const section = name => console.log(`\n== SECTION: ${name}`);
const rel = p => path.relative(DIR, p);

function walk(d, out = []) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = walk(DIR);

// ---------------------------------------------------------------- syntax
section('syntax');
{
  const js = files.filter(f => /\.(m?js)$/.test(f));
  const bad = [];
  for (const f of js) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) bad.push(`${rel(f)}: ${(r.stderr || '').split('\n').find(l => /Error/.test(l)) || 'error'}`);
  }
  check(`node --check on every .js/.mjs file (${js.length})`, bad.length === 0, bad.length ? bad.join(' | ') : 'no syntax errors');
}

// ---------------------------------------------------------------- imports
section('imports');
// 'three' and 'three/addons/' as the importmap in index.html maps them
const THREE_URL = pathToFileURL(path.join(SN, 'vendor/three@0.160.0/build/three.module.js')).href;
const ADDONS_URL = pathToFileURL(path.join(SN, 'vendor/three@0.160.0/examples/jsm/')).href;
const THREE_HOOK = `export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(THREE_URL)}, shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: new URL(spec.slice(13), ${JSON.stringify(ADDONS_URL)}).href, shortCircuit: true };
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(THREE_HOOK));
{
  const nodeSafe = files.filter(f => /\.js$/.test(f) && /\/(sim|mcu|parts|core|examples)\//.test(f) && !/\/sim\/worker\.js$/.test(f));
  nodeSafe.push(path.join(DIR, 'view/scene.js'), path.join(DIR, 'saver.js'));
  const bad = [];
  for (const f of nodeSafe) {
    try { await import(pathToFileURL(f).href); } catch (e) { bad.push(`${rel(f)}: ${e.name}: ${e.message}`); }
  }
  check(`node ESM import of ${nodeSafe.length} modules that must load without a DOM`, bad.length === 0, bad.length ? bad.slice(0, 6).join(' | ') : 'all imported');
}

// ---------------------------------------------------------------- markup
section('markup');
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(DIR, 'style.css'), 'utf8');
{
  const head = html.slice(0, html.indexOf('</head>'));
  const scripts = [...head.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
  const want = ['../../lib/gpu-guard.js', '../../lib/wishlist.js', '../../lib/stats-beacon.js'];
  check('head starts with gpu-guard.js, wishlist.js, stats-beacon.js in that order', want.every((s, i) => scripts[i] === s) && head.indexOf(want[0]) < head.indexOf('<meta'), scripts.slice(0, 3).join(', '));
  const im = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
  let map = null;
  try { map = im && JSON.parse(im[1]); } catch (e) { map = null; }
  check('importmap maps three and three/addons/ to vendor/three@0.160.0', !!map && map.imports.three === '../../vendor/three@0.160.0/build/three.module.js' && map.imports['three/addons/'] === '../../vendor/three@0.160.0/examples/jsm/', map ? Object.keys(map.imports).join(', ') : 'no importmap');
  check('importmap comes before the module script', html.indexOf('type="importmap"') < html.indexOf('type="module"'), '');
  const ids = ['stage', 'gl', 'bar', 'leftCol', 'rightCol', 'instrDock', 'status', 'toasts', 'dock', 'sheet', 'nogl', 'tip'];
  const missing = ids.filter(id => !new RegExp(`id="${id}"`).test(html));
  check('index.html has every DOM id of CONTRACT 4.4', missing.length === 0 && /<main id="stage"[^>]*><canvas id="gl"/.test(html), missing.length ? 'missing ' + missing.join(', ') : ids.join(' '));
  check('style.css has [hidden]{display:none!important}', /\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*;?\s*\}/.test(css), '');
  check('style.css is linked; no CDN, Playfair, Cormorant or JetBrains in the page', /href="style\.css"/.test(html) && !/https?:\/\/(cdn|unpkg|fonts\.googleapis)/.test(html + css) && !/Playfair|Cormorant|JetBrains/i.test(html + css), '');
  // an element with the hidden attribute must not be shown by an id rule
  const hiddenIds = [...html.matchAll(/<[a-z]+[^>]*\sid="([^"]+)"[^>]*\shidden[\s>]/g)].map(m => m[1]);
  const shows = hiddenIds.filter(id => new RegExp(`#${id}\\s*\\{[^}]*display\\s*:\\s*(?!none)[a-z-]+\\s*!important`).test(css));
  check('no hidden element has an !important display rule that shows it', shows.length === 0, `hidden at load: ${hiddenIds.join(', ') || 'none'}`);
  check('the page title is "Breadboard Lab"', /<title>Breadboard Lab — /.test(html), '');
  // landscape phone: the dock (bottom left, z 45) must end where the right
  // drawer (min(46vw, 400px), z 40) starts. Evaluate the two widths of the
  // landscape block at common phone sizes.
  {
    const block = (css.match(/@media \(max-height:520px\) and \(orientation:landscape\)\{([\s\S]*?)\n\}/) || [])[1] || '';
    const dockW = (/body\.phone #dock\{[^}]*width:([^;}]+)/.exec(block) || [])[1] || '';
    const sheetW = (/body\.phone #sheet,body\.phone #sheet\.full\{[^}]*width:([^;}]+)/.exec(block) || [])[1] || '';
    // a small evaluator for min(), calc(), px and vw
    const evalLen = (expr, vw) => Function('min', `return ${expr.replace(/calc\(/g, '(').replace(/(\d+(?:\.\d+)?)vw/g, (m, n) => `(${n}*${vw / 100})`).replace(/(\d+(?:\.\d+)?)px/g, '$1')};`)(Math.min);
    let worst = -Infinity, at = '';
    try {
      for (const [w] of [[844], [932], [740], [667], [568]]) {
        const over = evalLen(dockW, w) - (w - evalLen(sheetW, w));
        if (over > worst) { worst = over; at = `${w} px`; }
      }
    } catch (e) { worst = NaN; at = e.message; }
    check('landscape phone: the dock does not reach under the right drawer', worst <= 0.5, `dock ${dockW.trim()}, drawer ${sheetW.trim()}; worst overlap ${Number.isFinite(worst) ? worst.toFixed(1) + ' px at ' + at : at}`);
  }
}

// ---------------------------------------------------------------- examples
section('examples');
const { loadDeps, runExample, describe, fmtGot } = await import('./examples/verify.mjs');
const deps = await loadDeps();
const { EXAMPLES } = await import('./examples/index.js');
{
  const r = spawnSync(process.execPath, [path.join(DIR, 'examples/build.mjs'), '--check'], { encoding: 'utf8' });
  const last = (r.stdout || '').trim().split('\n').pop();
  check('examples/build.mjs --check: the JSON files match the builders', r.status === 0, last);
  const keys = EXAMPLES.map(e => e.key);
  const contract = ['first-led', 'no-resistor', 'ohms-law', 'divider-pot', 'button-pulldown', 'rc-charge', 'night-light', 'transistor-motor', 'blink-555', 'tone-555',
    'zener-reg', 'reg-7805', 'opamp-amp', 'rc-lowpass', 'thermostat', 'logic-gates', 'chaser-4017', 'flipflop-74', 'relay-lamp', 'mosfet-pwm', 'cc-limit', 'reverse-cap',
    'uno-blink', 'uno-button-serial', 'uno-fade-pot', 'uno-595', 'uno-7seg', 'uno-lcd-thermo', 'uno-melody', 'uno-servo', 'esp32-traffic', 'nano-joystick'];
  check('examples/index.js lists all 32 examples of CONTRACT 5, in order', keys.join() === contract.join(), `${keys.length} examples`);
  let passed = 0;
  for (const meta of EXAMPLES) {
    const ex = JSON.parse(fs.readFileSync(path.join(DIR, 'examples', meta.key + '.json'), 'utf8'));
    const { doc, warnings } = deps.normalizeDoc(JSON.parse(JSON.stringify(ex.doc)), { registry: deps.registry });
    const nl = deps.buildNetlist(doc, deps.registry, deps.geo);
    const bad = nl.issues.filter(i => i.level !== 'info' && !(ex.meta.expectIssues || []).includes(i.code)).map(i => i.code);
    const t0 = performance.now();
    const r = runExample(ex, deps);
    const ms = performance.now() - t0;
    const failed = r.results.filter(x => !x.ok);
    const ok = warnings.length === 0 && nl.warnings.length === 0 && bad.length === 0 && r.ok && ex.meta.checks.length > 0;
    if (ok) passed++;
    check(`example ${meta.key}: loads clean, ${ex.meta.checks.length} checks over ${r.t.toFixed(2)} s, no NaN`, ok,
      ok ? `${r.steps} steps in ${ms.toFixed(0)} ms; ` + r.results.slice(0, 2).map(x => `${describe(x.check).replace(/^t=\S+ /, '')} → ${fmtGot(x.got)}`).join('; ')
        : [warnings.length ? `repairs: ${warnings[0]}` : '', nl.warnings.length ? `netlist: ${nl.warnings[0]}` : '', bad.length ? `issues: ${bad.join(',')}` : '', r.nanAt !== null ? `NaN at ${r.nanAt}` : '',
          ...failed.map(x => `${x.text} got ${fmtGot(x.got)}`)].filter(Boolean).join(' | '));
  }
  check('at least 18 examples pass (CONTRACT 5 minimum)', passed >= 18, `${passed} of ${EXAMPLES.length}`);
  // the LED example: within 10 % of (Vs - Vf) / R
  {
    const ex = JSON.parse(fs.readFileSync(path.join(DIR, 'examples/first-led.json'), 'utf8'));
    const r = runExample(ex, deps);
    const m = r.results.find(x => x.check.probe);
    const want = (5 - 2.0) / 220;
    check('first-led: the meter reads (Vs − Vf) / R within 10 %', m && Math.abs(m.got / want - 1) < 0.1, m ? `${(m.got * 1e3).toFixed(2)} mA vs ${(want * 1e3).toFixed(2)} mA` : 'no reading');
  }
}

// ---------------------------------------------------------------- fixes
// integration bugs that main.js depends on, proved here
section('fixes');
{
  const seg = common => ({ format: 'breadboard-lab', version: 1, boards: [], wires: [], probes: [], materials: [], customParts: [], programs: {},
    parts: [{ id: 'p1', def: 'seg7-1', place: { on: null, x: 0, z: 0, rot: 0 }, params: { common } }] });
  const leds = c => deps.buildNetlist(seg(c), deps.registry, deps.geo).elements.filter(e => e.type === 'led');
  const cc = leds('cathode'), ca = leds('anode');
  const dir = (L, id) => { const e = L.find(x => x.vis === 'a'); return e ? e.id : 'none'; };
  check('seg7-1: the netlist honours the template "when" field (8 LEDs per common type, CONTRACT 3.5)', cc.length === 8 && ca.length === 8 && dir(cc) === 'p1/a' && dir(ca) === 'p1/a_ca', `cathode ${cc.length} LEDs (${dir(cc)}), anode ${ca.length} LEDs (${dir(ca)})`);
}

// ---------------------------------------------------------------- saver
section('saver');
const S = await import('./saver.js');
{
  const a = S.reelOrder(1), b = S.reelOrder(1), c = S.reelOrder(99);
  check('saver reel: seeded, complete, starts with the chaser or the 595 scanner', a.join() === b.join() && a.join() !== c.join() && S.FIRST.includes(a[0]) && new Set(a).size === S.REEL.length && a.every(k => EXAMPLES.some(e => e.key === k)), `${a.slice(0, 4).join(', ')} …`);
  const firsts = new Set(Array.from({ length: 40 }, (_, i) => S.reelOrder(i + 1)[0]));
  check('saver reel: both first benches occur over seeds', firsts.size === 2, [...firsts].join(', '));
  let rnd = S.mulberry(7), okShots = true;
  for (let i = 0; i < 200; i++) { const s = S.shotsFor(rnd); if (s.length < 2 || s.length > 3 || s[0] === 'top' || s.some((k, j) => j && k === s[j - 1])) okShots = false; }
  check('saver shots: 2 or 3 per bench, no repeats in a row, no top view first', okShots, '');
  const driven = Object.keys(S.DRIVE).filter(k => S.REEL.includes(k));
  const labelsOk = driven.every(k => {
    const ex = JSON.parse(fs.readFileSync(path.join(DIR, 'examples', k + '.json'), 'utf8'));
    return S.DRIVE[k](1.3).every(([lab]) => ex.doc.parts.some(p => p.label === lab));
  });
  check('saver drives name parts that exist in their benches', labelsOk, driven.join(', '));

  // framing: project the box corners of each shot
  const project = (st, fr, p) => {
    const pos = S.posOf(st);
    const f = norm(sub(st.target, pos));
    const r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
    const v = sub(p, pos), z = dot(v, f);
    const th = Math.tan(fr.fov * Math.PI / 360);
    const nx = dot(v, r) / (z * th * (fr.w / fr.h)), ny = dot(v, u) / (z * th);
    const off = S.bandOffset(fr);
    return { x: (nx + 1) / 2 * fr.w - off.x, y: (1 - ny) / 2 * fr.h - off.y, z };
  };
  const frames = {
    '16:9': { w: 1600, h: 900, fov: 38, band: { t: 170, b: 210, w: 1600 } },
    '9:16': { w: 900, h: 1600, fov: 38, band: { t: 300, b: 360, w: 900 } },
    '9:16 column': { w: 1600, h: 900, fov: 38, band: { t: 150, b: 190, w: 506 } },
    'no plate': { w: 1280, h: 800, fov: 38, band: null },
  };
  for (const [name, fr] of Object.entries(frames)) {
    const A = S.clearArea(fr);
    let worst = 0, n = 0, out = [];
    for (const key of S.REEL) {
      const ex = JSON.parse(fs.readFileSync(path.join(DIR, 'examples', key + '.json'), 'utf8'));
      const box = S.docBox(ex.doc, deps.registry, deps.geo);
      const part = ex.doc.parts.find(p => p.place.on) || ex.doc.parts[0];
      const pbox = S.partBox(ex.doc, part, deps.registry.get(part.def), deps.geo);
      for (const [kind, bx] of [['bench', box], ['top', box], ['active', pbox]]) {
        for (const yaw of [-0.55, 0, 0.55]) {
          for (const pitch of [0.82, 1.07]) {
            const st = S.shotPose(kind, bx, fr, yaw, pitch);
            for (const cx of [bx.min[0], bx.max[0]]) for (const cy of [bx.min[1], bx.max[1]]) for (const cz of [bx.min[2], bx.max[2]]) {
              const q = project(st, fr, [cx, cy, cz]);
              n++;
              const over = Math.max(A.left - q.x, q.x - A.right, A.top - q.y, q.y - A.bottom, 0);
              if (over > worst) { worst = over; out = [key, kind, yaw, pitch]; }
            }
          }
        }
      }
    }
    check(`saver framing ${name}: every shot box of the ${S.REEL.length} reel benches stays in the clear area`, worst <= 0.5, `${n} corners; worst ${worst.toFixed(1)} px outside${worst > 0.5 ? ` (${out.join(' ')})` : ''}; clear ${Math.round(A.right - A.left)} × ${Math.round(A.bottom - A.top)} px`);
  }
  // a bench should not be a dot: the bench box fills a fair part of the band
  {
    const fr = frames['9:16'], A = S.clearArea(fr);
    const ex = JSON.parse(fs.readFileSync(path.join(DIR, 'examples/chaser-4017.json'), 'utf8'));
    const box = S.docBox(ex.doc, deps.registry, deps.geo);
    const st = S.shotPose('bench', box, fr, 0, 0.95);
    const xs = [];
    for (const cx of [box.min[0], box.max[0]]) for (const cz of [box.min[2], box.max[2]]) xs.push(project(st, fr, [cx, 0, cz]).x);
    const span = (Math.max(...xs) - Math.min(...xs)) / (A.right - A.left);
    check('saver framing 9:16: the chaser bench spans at least half the column width', span > 0.5, `${(span * 100).toFixed(0)} % of the column`);
  }
  const fakeFrame = { parts: { p1: { i: 0.01, vis: { b: 0.5 } }, p2: { i: 0.0, vis: { omega: 600 } }, p3: { vis: { leds: { L: 1 } } } } };
  const fakeDoc = { parts: [{ id: 'p1', def: 'led' }, { id: 'p2', def: 'motor-dc' }, { id: 'p3', def: 'mcu-uno' }] };
  check('activePart picks a spinning motor over a dim LED and the board LED', S.activePart(fakeFrame, fakeDoc, deps.registry) === 'p2', S.activePart(fakeFrame, fakeDoc, deps.registry));
}
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

// ---------------------------------------------------------------- boot
section('boot');
{
  const { installDom, mkEvent } = await import('./ui/fakedom.mjs');
  installDom({ width: 1400, height: 900 });
  // the page's static ids, read from index.html (so the markup is what boots)
  const tags = [...html.matchAll(/<(main|header|aside|div|footer|nav|canvas)\s+id="([^"]+)"([^>]*)>/g)];
  const byId = {};
  for (const [, tag, id, rest] of tags) {
    const el = document.createElement(tag);
    el.id = id;
    if (/\shidden/.test(rest)) el.hidden = true;
    byId[id] = el;
    (id === 'gl' ? byId.stage : document.body).appendChild(el);
  }
  const listeners = {};
  globalThis.addEventListener = (t, fn) => { (listeners[t] || (listeners[t] = [])).push(fn); };
  globalThis.removeEventListener = () => {};
  globalThis.location = { search: '', hash: '', href: pathToFileURL(path.join(DIR, 'index.html')).href, reload() {} };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async function fileFetch(url, o) {
    const u = String(url);
    if (!u.startsWith('file:')) return realFetch(url, o);
    try { const text = fs.readFileSync(fileURLToPath(u), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text }; }
    catch (e) { return { ok: false, status: 404, json: async () => null, text: async () => '' }; }
  };
  const errs = [];
  const oldErr = console.error, oldWarn = console.warn;
  console.error = (...a) => errs.push(a.map(String).join(' '));
  console.warn = () => {};
  let bootErr = null;
  try { await import('./main.js'); } catch (e) { bootErr = e; }
  check('main.js imports and runs in node on the fake DOM (no SyntaxError, no throw)', !bootErr, bootErr ? `${bootErr.name}: ${bootErr.message}` : 'ran to its end');
  const B = globalThis.bblab;
  if (B) {
    check('start: no share link, no autosave → the first example is on the bench', B.store.doc.title === EXAMPLES[0].title, `"${B.store.doc.title}", ${B.store.doc.parts.length} parts`);
    check('no WebGL in node → the stub view and the #nogl message', B.view.stub === true && byId.nogl && byId.nogl.hidden === false, `nogl hidden = ${byId.nogl && byId.nogl.hidden}`);
    const frames = [];
    const off = B.bus.on('sim:frame', f => frames.push(f));
    await new Promise(r => setTimeout(r, 700));
    const f = frames[frames.length - 1];
    const led = B.store.doc.parts.find(p => p.def === 'led');
    const i = f && led && f.parts[led.id] ? f.parts[led.id].i : NaN;
    check('the inline sim runs: frames reach the bus and the LED draws about 13.6 mA', frames.length >= 5 && Math.abs(i / 0.0136 - 1) < 0.1, `${frames.length} frames in 0.7 s, t = ${f ? f.t.toFixed(3) : '-'} s, LED ${(i * 1e3).toFixed(2)} mA`);
    check('the netlist reached the page with no warn/error issues', B.netlist && B.netlist.issues.filter(x => x.level !== 'info').length === 0, B.netlist ? `${B.netlist.nodeCount} nodes, ${B.netlist.elements.length} elements` : 'no netlist');
    // a live edit: the supply to 9 V reaches the sim without a rebuild
    const ps = B.store.doc.parts.find(p => p.def === 'supply-bench');
    B.store.apply({ op: 'set', id: ps.id, path: 'params.v', value: 9 });
    const n0 = frames.length;
    await new Promise(r => setTimeout(r, 300));
    const f2 = frames[frames.length - 1];
    const i2 = f2 && f2.parts[led.id] ? f2.parts[led.id].i : NaN;
    check('a live param edit (supply 5 → 9 V) changes the LED current', frames.length > n0 && i2 > 0.025, `${(i2 * 1e3).toFixed(1)} mA at 9 V`);
    B.store.undo();
    // a topology edit: remove the LED's ground wire → the LED goes dark
    const w = B.store.doc.wires.find(x => x.a.hole === 'b1:a15' || x.b.hole === 'b1:a15');
    B.store.apply({ op: 'remove', ids: [w.id] });
    await new Promise(r => setTimeout(r, 300));
    const f3 = frames[frames.length - 1];
    const i3 = f3 && f3.parts[led.id] ? f3.parts[led.id].i : NaN;
    check('a topology edit (remove the ground wire) rebuilds and the LED goes dark', Math.abs(i3) < 1e-5, `${(i3 * 1e3).toFixed(4)} mA, t = ${f3 ? f3.t.toFixed(2) : '-'} s (carried on)`);
    B.store.undo();
    off();
    // the saver hook
    const labels = [];
    const out = window.snSaver.enter({ seed: 3, calm: 0.7, seconds: 60, label: x => labels.push(x) });
    await new Promise(r => setTimeout(r, 1500));
    const dbg = window.snSaver.debug();
    const named = labels.filter(Boolean).map(l => l.title);
    check('snSaver.enter returns { canvas, warmupMs } with the page canvas', out && out.canvas === byId.gl && out.warmupMs > 0, `warmupMs ${out && out.warmupMs}`);
    check('the saver loads its first bench and names it on the plate', S.FIRST.includes(dbg.bench) && named.some(t => EXAMPLES.some(e => e.title === t && e.key === dbg.bench)) && B.store.doc.title === named[named.length - 1], `bench ${dbg.bench}, plate "${named[named.length - 1]}", shot ${dbg.shot}`);
    check('the saver keeps the autosave: no write while it runs', (() => { try { localStorage.setItem('bblab:autosave', 'X'); return localStorage.getItem('bblab:autosave') !== 'X'; } catch (e) { return false; } })(), '');
    window.snSaver.exit();
    check('snSaver.exit clears the plate and restores storage', labels[labels.length - 1] === null && (() => { localStorage.setItem('bblab:probe', '1'); return localStorage.getItem('bblab:probe') === '1'; })(), '');
    for (const fn of listeners.pagehide || []) fn({ persisted: false });
    const n1 = frames.length;
    await new Promise(r => setTimeout(r, 200));
    check('pagehide releases: the sim stops sending frames', frames.length === n1, `${frames.length - n1} frames after pagehide`);
  }
  console.error = oldErr; console.warn = oldWarn;
  check('no console.error during the boot', errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');
}

// ---------------------------------------------------------------- scenarios
// one page boot per process (boot-scenarios.mjs): saver, pagehide, links,
// the no-WebGL text and a custom part from the autosave
section('scenarios');
for (const [name, what] of [
  ['saver-restore', 'the saver gives back the bench, undo, run state; the autosave after exit is the user\'s'],
  ['pagehide-flush', 'an edit 300 ms before pagehide reaches the autosave'],
  ['link-once', 'a #d= link loads once: the hash is cleared after the load'],
  ['example-once', '?example= loads once: the query is cleared after the load'],
  ['nogl-text', 'no WebGL: #nogl keeps the index.html text (the panels still work)'],
  ['custom-autosave', 'a custom part on a board from the autosave has its pins on the strips'],
  ['jsdom-desktop', 'main.js boots on jsdom at 1440 x 900: the bar, every button named, no errors'],
  ['jsdom-phone', 'main.js boots on jsdom at 390 x 844 (coarse): body.phone, the dock, every button named'],
]) {
  const r = spawnSync(process.execPath, [path.join(DIR, 'boot-scenarios.mjs'), name], { encoding: 'utf8', timeout: 60000 });
  let out = null;
  try { out = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch (e) { out = null; }
  check(`scenario ${name}: ${what}`, !!out && out.ok === true, out ? out.measured : `no result (exit ${r.status}) ${(r.stderr || '').split('\n')[0]}`);
}

// ---------------------------------------------------------------- roles
section('roles');
if (quick) console.log('   --quick: role tests skipped');
else {
  for (const t of ['sim/tests.mjs', 'parts/tests.mjs', 'view/tests.mjs', 'mcu/tests.mjs', 'mcu/avr-tests.mjs', 'ui/tests.mjs']) {
    const r = spawnSync(process.execPath, [path.join(DIR, t)], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 600000 });
    const lines = (r.stdout || '').trim().split('\n');
    const summary = lines.filter(l => /passed|failed|checks/i.test(l)).pop() || lines.pop();
    const failLines = lines.filter(l => /^FAIL/.test(l));
    check(`role tests ${t}`, r.status === 0, `${summary}${failLines.length ? ' | ' + failLines.slice(0, 3).join(' | ') : ''}`);
  }
}

// ---------------------------------------------------------------- site
section('site');
{
  const run = (args) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 << 20 });
  const nav = fs.readFileSync(path.join(SN, 'lib/nav-data.js'), 'utf8');
  check('lib/nav-data.js registers breadboard-lab once', (nav.match(/"breadboard-lab"/g) || []).length === 1, '');
  const ns = run(['tools/nav-sync.js', '--check']);
  const nsOut = (ns.stdout || '') + (ns.stderr || '');
  const mine = nsOut.split('\n').filter(l => /breadboard-lab/.test(l));
  check('nav-sync --check has no finding about breadboard-lab', mine.length === 0, `exit ${ns.status}${mine.length ? ': ' + mine.join(' | ') : ns.status ? ' (other pages: ' + nsOut.split('\n').filter(Boolean).slice(-1)[0] + ')' : ''}`);
  const wl = run(['tools/wishlist-check.mjs']);
  const wlMine = ((wl.stdout || '') + (wl.stderr || '')).split('\n').filter(l => /FAIL/.test(l) && /breadboard-lab/.test(l));
  check('wishlist-check has no failure about breadboard-lab', wlMine.length === 0, `exit ${wl.status}; ${((wl.stdout || '').trim().split('\n').pop() || '')}`);
  const home = run(['stella-nova/pages/home/tests.mjs']);
  const homeMine = ((home.stdout || '') + (home.stderr || '')).split('\n').filter(l => /FAIL/.test(l) && /breadboard-lab/.test(l));
  check('home tests have no failure about breadboard-lab', homeMine.length === 0, `exit ${home.status}; ${((home.stdout || '').trim().split('\n').pop() || '')}`);
  const th = run(['tools/thumbs-list.mjs', '--check']);
  check('thumbs-list --check', th.status === 0 || !/breadboard-lab/.test((th.stdout || '') + (th.stderr || '')), `exit ${th.status}; ${((th.stdout || '') + (th.stderr || '')).trim().split('\n').pop() || 'clean'}`);
}

console.log(`\n${count - fails}/${count} checks passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
