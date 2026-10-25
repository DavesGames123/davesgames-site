// ============================================================================
//  ALPHA QUDITS  ·  saver/tests.mjs  ·  node tests of the SAVER package
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/alpha-qudits/saver/tests.mjs
//  Optional: NODE_PATH holding jsdom@24.1.3 (runs the hook: enter, cuts,
//  plates, exit) and mathjax-full@3.2.2 (typesets every plate TeX string).
//  Without them, a skip line prints and the other checks still run.
//
//  SECTIONS   (grep -n "section('" tests.mjs)
//    shots ....... every package's saverShots, tagged and complete
//    plan ........ seeded shuffle: all shots per run, 5-12 s, no repeats
//    framing ..... the box in the plate band at 16:9 and 9:16; each package
//                  fit stays in the box
//    draws ....... renderShot of STRANDS and COMPARE on a mock canvas at
//                  16:9 and 9:16: no throw, no NaN, text in the box
//    code ........ every extract is cut from the real model/ source
//    plate ....... plates, live MODEL values, TeX typesets (MathJax)
//    hook ........ window.snSaver in jsdom (skip without jsdom)
// ============================================================================
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
let pass = 0, fail = 0, skip = 0;
const section = s => console.log('\n## ' + s);
async function check(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e)); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const P = await import(pathToFileURL(join(HERE, 'plan.js')).href);
const { probeContext, fitScale, textsInBox } = await import(pathToFileURL(join(HERE, 'probe.js')).href);
const { bandFloor } = await import(pathToFileURL(join(ROOT, '../../lib/saver-clear.js')).href);

const mods = {};
for (const p of [...P.PKGS, 'model']) {
  try { mods[p] = await import(pathToFileURL(join(ROOT, p, 'index.js')).href); }
  catch (e) { console.log(`  note ${p}/index.js does not load in node: ${e.message.split('\n')[0]}`); }
}
const shots = P.collectShots(mods);
const facts = P.modelFacts(mods.model);

// The probe context of saver/probe.js is the mock canvas: it keeps the
// transform, records text anchors and the first NaN argument.
const mockCtx = probeContext;

// The frames under test: 16:9 fill, and the 9:16 column (the iframe at
// the column width, and a wide iframe with band.w set to the column).
// The band uses plate text heights like the shell (title block about
// 24 % of h, the bottom block about 30 %), floored by bandFloor.
const FRAMES = [
  { name: '16:9 1920x1080', w: 1920, h: 1080, t: 0.24, b: 0.30, col: null },
  { name: '16:9 1280x720', w: 1280, h: 720, t: 0.26, b: 0.32, col: null },
  { name: '9:16 608x1080', w: 608, h: 1080, t: 0.22, b: 0.36, col: null },
  { name: '9:16 column in 1920x1080', w: 1920, h: 1080, t: 0.22, b: 0.36, col: 607.5 },
  { name: '9:16 phone 390x693', w: 390, h: 693, t: 0.30, b: 0.42, col: null },
];
const bandOf = F => { const f = bandFloor(F.t * F.h, F.b * F.h, F.h); return { t: f.t, b: f.b, w: F.col || F.w }; };

// ============================================================================
section('shots');
await check('STRANDS, ENDS and RECORDS shots load (COMPARE when it is in the tree)', () => {
  for (const p of ['strands', 'ends', 'records']) assert(shots.some(s => s.pkg === p), `no shots from ${p}`);
  const by = Object.fromEntries(P.PKGS.map(p => [p, shots.filter(s => s.pkg === p).length]));
  console.log('       shots per package: ' + JSON.stringify(by) + `, total ${shots.length}`);
  assert(shots.length >= 30, 'fewer than 30 shots');
});
await check('every shot has pkg, unique id, a known scene, title, caption and TeX', () => {
  const ids = new Set();
  for (const s of shots) {
    assert(!ids.has(s.id), 'duplicate id ' + s.id); ids.add(s.id);
    const m = mods[s.pkg];
    const scenes = m.SCENES || m.SCENE_NAMES;
    assert(!scenes || scenes.includes(s.scene), `${s.id}: scene ${s.scene} not in ${s.pkg}`);
    assert(s.title && s.title.length < 70, `${s.id}: title`);
    assert(s.caption && s.caption.length <= 140, `${s.id}: caption missing or long (${s.caption.length})`);
    assert(typeof s.tex === 'string' && s.tex.length, `${s.id}: no TeX`);
  }
});
await check('every STRANDS shot has a caption written here', () => {
  for (const s of shots.filter(x => x.pkg === 'strands')) assert(P.STRANDS_CAPTIONS[s.id], 'no caption for ' + s.id);
});

// ============================================================================
section('plan');
const plan = P.shotPlan(shots, 7, 4 * shots.length, 0.7);
await check('the plan is the same for the same seed and differs for another seed', () => {
  const a = P.shotPlan(shots, 7, 60).map(s => s.id).join(), b = P.shotPlan(shots, 7, 60).map(s => s.id).join(), c = P.shotPlan(shots, 8, 60).map(s => s.id).join();
  assert(a === b, 'seed 7 differs between runs'); assert(a !== c, 'seeds 7 and 8 give the same plan');
});
await check('each run through the plan shows every shot once', () => {
  for (let k = 0; k < 4; k++) {
    const run = plan.slice(k * shots.length, (k + 1) * shots.length).map(s => s.id).sort();
    assert(run.join() === shots.map(s => s.id).sort().join(), `run ${k} is not a permutation`);
  }
});
await check('cuts every 5 to 12 s at calm 0, 0.7 and 1', () => {
  for (const calm of [0, 0.7, 1]) for (const s of P.shotPlan(shots, 3, 2 * shots.length, calm)) assert(s.sec >= 5 && s.sec <= 12, `${s.id} ${s.sec} s at calm ${calm}`);
});
await check('no shot follows itself, and the package changes at almost every cut', () => {
  let same = 0;
  for (let i = 1; i < plan.length; i++) { assert(plan[i].id !== plan[i - 1].id, 'repeat at ' + i); if (plan[i].pkg === plan[i - 1].pkg) same++; }
  console.log(`       same package twice in a row: ${same} of ${plan.length - 1} cuts`);
  assert(same <= Math.ceil(plan.length * 0.05), 'too many same-package cuts');
});
await check('a seeded plan of 120 shots covers more than 15 min', () => {
  const sec = P.shotPlan(shots, 1, 120).reduce((a, s) => a + s.sec, 0);
  assert(sec > 900, `only ${sec} s`);
});

// ============================================================================
section('framing');
const inside = (r, b, tol = 0.5) => r.x >= b.x - tol && r.y >= b.y - tol && r.x + r.w <= b.x + b.w + tol && r.y + r.h <= b.y + b.h + tol;
for (const F of FRAMES) {
  const band = bandOf(F), box = P.frameBox(F.w, F.h, band);
  const colX = (F.w - band.w) / 2;
  await check(`${F.name}: the box is in the clear band and the column`, () => {
    assert(box.y >= band.t && box.y + box.h <= F.h - band.b + 0.01, `box ${JSON.stringify(box)} leaves the band t ${band.t} b ${band.b}`);
    assert(box.x >= colX && box.x + box.w <= colX + band.w + 0.01, 'box leaves the column');
    assert(box.h >= 0.3 * F.h * 0.9, `band too small: ${box.h}`);
  });
  await check(`${F.name}: every package fit stays in the box and fills one side`, () => {
    let worst = 1;
    for (const s of shots) {
      let r;
      if (s.pkg === 'strands') {
        const R = (box.w / box.h); const want = s.aspect || 1.5, asp = Math.max(0.56, Math.min(want, R));
        let w = box.w, h = w / asp; if (h > box.h) { h = box.h; w = h * asp; }
        r = { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
      } else if (s.pkg === 'ends') {
        const L = mods.ends.fitLayout(mods.ends.SCENE_MODULES[s.scene], box.w, box.h);
        r = { x: box.x + (box.w - L.w * L.k) / 2, y: box.y + (box.h - L.h * L.k) / 2, w: L.w * L.k, h: L.h * L.k };
      } else if (s.pkg === 'records') {
        const f = mods.records.fitScene(mods.records.SCENE_MODULES[s.scene], box.w, box.h);
        r = { x: box.x + f.ox, y: box.y + f.oy, w: f.Wn * f.s, h: f.Hn * f.s };
      } else r = { ...box };
      assert(inside(r, box), `${s.id}: ${JSON.stringify(r)} outside ${JSON.stringify(box)}`);
      worst = Math.min(worst, Math.max(r.w / box.w, r.h / box.h));
    }
    assert(worst > 0.97, `a subject fills only ${worst.toFixed(2)} of the box on its longer side`);
  });
}
await check('no plate: the box is the whole frame less the margins', () => {
  const b = P.frameBox(1920, 1080, null);
  assert(b.y < 40 && b.h > 1000 && b.w > 1800, JSON.stringify(b));
});

// ============================================================================
section('draws');
// STRANDS and COMPARE draw into the box with no DOM, on the saver path:
// fitScale picks the scale from 4 probe times, then the shot draws at 7
// other times. Every text anchor must stay within 6 px of the box.
const scales = [], skipped = [], fitted = new Map();
for (const F of FRAMES) {
  const box = P.frameBox(F.w, F.h, bandOf(F));
  for (const s of shots.filter(x => x.pkg === 'strands' || x.pkg === 'compare')) {
    await check(`${F.name} ${s.id}: draws at 7 times, no NaN, text in the box`, () => {
      const m = mods[s.pkg], sec = P.shotSeconds(s), probe = { ...s, id: s.id + '#probe' };
      const k = fitScale((pg, tt, vb) => m.renderShot(pg, probe, tt, vb, { calm: false }), box, [0, 0.35, 0.7, 1].map(q => q * sec * 0.72));
      if (k < 1) scales.push(`${s.id} ${k}`);
      fitted.set(F.name + ' ' + s.id, k);
      if (k < P.MIN_SCALE) { skipped.push(`${F.name} ${s.id} (${k})`); return; }
      for (const t of [0.1, 0.9, 1.7, 3.1, 4.4, sec * 0.55, sec * 0.9]) {
        const g = mockCtx();
        g.translate(box.x, box.y); g.scale(k, k);
        m.renderShot(g, s, t, { x: 0, y: 0, w: box.w / k, h: box.h / k }, { calm: false });
        assert(!g.__nan, `t ${t}: NaN in ${g.__nan}`);
        const bad = g.__texts.find(q => !textsInBox([q], box));
        assert(!bad, bad && `t ${t}: "${bad.t}" at ${bad.x.toFixed(0)},${bad.y.toFixed(0)} outside the box at scale ${k}`);
      }
    });
  }
}
console.log('       scaled down to fit: ' + (scales.length ? scales.join('; ') : 'none'));
console.log('       skipped as too small (saver cuts past them): ' + (skipped.length ? skipped.join('; ') : 'none'));
// The share of shots each frame shows at MIN_SCALE or more. Frames 1080
// px tall and the 390 x 844 phone must show all. At 1280 x 720 the two
// abacus shots are too tall for the band; a 390 x 693 frame shows half.
const scaleIn = (F, s) => {
  const box = P.frameBox(F.w, F.h, bandOf(F));
  if (s.pkg === 'ends') return mods.ends.fitLayout(mods.ends.SCENE_MODULES[s.scene], box.w, box.h).k;
  if (s.pkg === 'records') return mods.records.fitScene(mods.records.SCENE_MODULES[s.scene], box.w, box.h).s;
  return fitted.get(F.name + ' ' + s.id);
};
const PHONE = { name: '9:16 phone 390x844', w: 390, h: 844, t: 0.24, b: 0.34, col: null };
for (const F of [...FRAMES, PHONE]) {
  await check(`${F.name}: share of legible shots`, () => {
    if (F === PHONE) { const box = P.frameBox(F.w, F.h, bandOf(F)); for (const s of shots.filter(x => x.pkg === 'strands' || x.pkg === 'compare')) fitted.set(F.name + ' ' + s.id, fitScale((pg, tt, vb) => mods[s.pkg].renderShot(pg, { ...s, id: s.id + '#p2' }, tt, vb, {}), box, [0, 3, 6])); }
    const ok = shots.filter(s => scaleIn(F, s) >= P.MIN_SCALE).length, share = ok / shots.length;
    console.log(`       ${F.name}: ${ok} of ${shots.length} legible`);
    const need = F.h >= 1000 || F === PHONE ? 1 : F.w >= 1280 ? 0.9 : 0.5;
    assert(share >= need, `only ${(share * 100).toFixed(0)} % legible`);
  });
}
await check('pickLegible skips shots below MIN_SCALE and falls back when none is legible', () => {
  const pl = [{ id: 'a', k: 0.3 }, { id: 'b', k: 0.4 }, { id: 'c', k: 0.9 }, { id: 'd', k: 0.2 }];
  assert(P.pickLegible(pl, 0, x => x.k) === 2, 'skip to c');
  assert(P.pickLegible(pl, 3, x => x.k) === 6, 'wrap to c of the next run');
  assert(P.pickLegible(pl, 1, () => 0.1) === 1, 'fallback');
});

// ============================================================================
section('code');
await check('every CODE extract is cut from the real model/ file, 12 lines or fewer', () => {
  for (const [k, c] of Object.entries(P.CODE)) {
    const f = join(ROOT, 'model', c.file);
    assert(existsSync(f), `${k}: no model/${c.file}`);
    const src = readFileSync(f, 'utf8');
    const x = P.extractCode(src, c.fn);
    assert(x, `${k}: function ${c.fn} not in model/${c.file}`);
    const lines = x.split('\n');
    assert(lines.length <= P.CODE_LINES, `${k}: ${lines.length} lines`);
    assert(new RegExp('function ' + c.fn + '\\s*\\(').test(lines[0]), `${k}: first line ${lines[0]}`);
    for (const l of lines) if (l !== '  // ...') assert(src.includes(l), `${k}: line not in source: ${l}`);
  }
});
await check('every shot has a code extract', () => {
  for (const s of shots) assert(P.codeFor(s), 'no code for ' + s.pkg + ':' + s.scene);
});
await check('extractCode: a one-line body, a long body, and a missing name', () => {
  assert(P.extractCode('export function a(x) { return x; }\nconst b = 1;', 'a') === 'export function a(x) { return x; }', 'one line');
  const long = 'function f() {\n' + Array.from({ length: 30 }, (_, i) => `  x${i}();`).join('\n') + '\n}';
  const x = P.extractCode(long, 'f').split('\n');
  assert(x.length === 12 && x[11] === '  // ...', 'long body cut');
  assert(P.extractCode('function g() {}', 'h') === null, 'missing');
});

// ============================================================================
section('plate');
await check('MODEL facts: candidate digits, N = 24 · 36 · 36, 172 records, Y = 1/6', () => {
  assert(facts, 'model/index.js did not give facts');
  assert(facts.inv.startsWith('137.035999189566'), facts.inv);
  assert(facts.N === 31104 && facts.unread === 24 && facts.read === 36, JSON.stringify(facts));
  assert(facts.records === 172 && facts.y === '1/6', JSON.stringify(facts));
});
await check('every plate: title, analogy line, TeX, caption first, credit last, a stance line on comparisons', () => {
  for (const s of shots) {
    const c = P.codeFor(s), src = readFileSync(join(ROOT, 'model', c.file), 'utf8');
    const p = P.plateFor(s, { code: P.extractCode(src, c.fn), facts });
    assert(p.title && p.sub, `${s.id}: title or sub`);
    assert(p.tex.length === 1, `${s.id}: tex`);
    assert(p.lines[0] === s.caption && p.lines[p.lines.length - 1] === P.CREDIT, `${s.id}: lines`);
    if (s.pkg === 'compare') assert(p.lines.includes(P.STANCE), `${s.id}: no stance line`);
    assert(p.code && p.code.text && p.code.name.startsWith('model/'), `${s.id}: code`);
    for (const r of p.rules) assert(/^m[1-6]$/.test(r[1]) && p.tex[0].includes(r[0]), `${s.id}: rule ${r}`);
    for (const q of p.params) assert(/^m[1-6]$/.test(q.cls) && q.value && q.sym, `${s.id}: param`);
    assert(p.lines.every(l => !/[A-Z]{4,}/.test(l.replace(/CODATA|QED/g, ''))), `${s.id}: capitals in a line`);
  }
});
await check('a plate without code or facts still has its text', () => {
  const p = P.plateFor(shots[0]);
  assert(p.title && !p.code && Array.isArray(p.params) && p.params.length === 0, JSON.stringify(p));
});

const findMod = name => {
  const dirs = (process.env.NODE_PATH || '').split(':').filter(Boolean);
  for (const d of dirs) for (const base of [join(d, 'x.js'), join(d, '..', 'x.js')]) { try { return createRequire(base)(name); } catch (e) { /* next */ } }
  return null;
};
const mj = findMod('mathjax-full/js/mathjax.js');
if (!mj) { skip++; console.log('  skip mathjax: mathjax-full not found on NODE_PATH'); }
else {
  await check('every plate TeX string typesets in MathJax 3 (with the colour rules)', async () => {
    const { TeX } = findMod('mathjax-full/js/input/tex.js'), { SVG } = findMod('mathjax-full/js/output/svg.js');
    const { liteAdaptor } = findMod('mathjax-full/js/adaptors/liteAdaptor.js'), { RegisterHTMLHandler } = findMod('mathjax-full/js/handlers/html.js');
    const { AllPackages } = findMod('mathjax-full/js/input/tex/AllPackages.js');
    RegisterHTMLHandler(liteAdaptor());
    const doc = mj.mathjax.document('', { InputJax: new TeX({ packages: AllPackages.filter(p => p !== 'bussproofs'), formatError: (j, e) => { throw e; } }), OutputJax: new SVG({ fontCache: 'none' }) });
    const { colorize } = await import(pathToFileURL(join(ROOT, '../../lib/sci-math.js')).href).catch(() => ({ colorize: null }));
    let n = 0;
    for (const s of shots) {
      const p = P.plateFor(s, { facts });
      const all = [...p.tex, ...p.params.map(q => q.sym)];
      for (const t of all) { doc.convert(colorize ? colorize(t, p.rules) : t, { display: true }); n++; }
    }
    console.log(`       ${n} TeX strings typeset` + (colorize ? ' after colorize()' : ' (sci-math colorize did not load in node)'));
  });
}

// ============================================================================
section('hook');
const jsdom = findMod('jsdom');
if (!jsdom) { skip++; console.log('  skip hook: jsdom not found on NODE_PATH'); }
else {
  await check('snSaver in jsdom: enter, 40 cuts over every package, plates with code, no bad frame, exit', async () => {
    const dom = new jsdom.JSDOM('<!doctype html><html><head></head><body><main id="page">page</main></body></html>', { pretendToBeVisual: true, url: 'http://localhost/stella-nova/pages/alpha-qudits/' });
    const W = dom.window;
    const contexts = [];
    W.HTMLCanvasElement.prototype.getContext = function () { const c = mockCtx(); contexts.push(c); return c; };
    let cbs = [], now = 0;
    const g = globalThis;
    const keep = {};
    const set = (k, v) => { keep[k] = Object.getOwnPropertyDescriptor(g, k); Object.defineProperty(g, k, { value: v, configurable: true, writable: true }); };
    set('window', W); set('document', W.document); set('innerWidth', 1280); set('innerHeight', 720); set('devicePixelRatio', 1);
    set('requestAnimationFrame', f => { cbs.push(f); return cbs.length; }); set('cancelAnimationFrame', () => { cbs = []; });
    set('HTMLElement', W.HTMLElement); set('getComputedStyle', W.getComputedStyle.bind(W));
    set('fetch', async u => { const p = fileURLToPath(new URL(String(u))); return { ok: existsSync(p), text: async () => readFileSync(p, 'utf8') }; });
    try {
      await import(pathToFileURL(join(HERE, 'index.js')).href + '?hook');
      assert(typeof W.snSaver.enter === 'function' && typeof W.snSaver.exit === 'function', 'no hook on window');
      const plates = [];
      const res = await W.snSaver.enter({ calm: 0.7, seed: 11, label: info => plates.push(info) });
      assert(res && res.canvas && W.document.getElementById('aqSaverCv') === res.canvas, 'no canvas in the document');
      assert(W.__aqSaver === true, '__aqSaver not set');
      const seen = new Set(), pkgs = new Set();
      let frames = 0;
      while (frames < 40000 && seen.size < 40) {
        now += 50; const f = cbs.shift(); if (!f) break; f(now); frames++;
        const d = W.snSaver.debug(); seen.add(d.i); pkgs.add(d.pkg);
        if (W.document.querySelectorAll('.aqs-host').length > 1) throw new Error('more than one fill host');
      }
      const d = W.snSaver.debug();
      console.log(`       ${frames} frames, ${seen.size} shots, packages ${[...pkgs].join(' ')}, ${plates.length} plates, errs ${d.errs}${d.lastErr ? ' (' + d.lastErr + ')' : ''}`);
      assert(d.errs === 0, 'bad frames: ' + d.lastErr);
      assert(seen.size >= 40, 'too few cuts');
      for (const p of ['strands', 'ends', 'records']) assert(pkgs.has(p), 'no shot from ' + p);
      assert(plates.length >= 40 && plates.every(p => p.title && p.code && p.code.text && typeof p.anchor === 'function'), 'plate without code or anchor');
      const a = plates[plates.length - 1].anchor();
      assert(a && a.w > 0 && a.h > 0, 'anchor');
      W.snSaver.cut(shots.find(s => s.pkg === 'ends').id); now += 50; cbs.shift()(now);
      assert(W.snSaver.debug().pkg === 'ends', 'cut to an ENDS shot');
      W.snSaver.exit();
      assert(!W.document.getElementById('aqSaverCv') && !W.document.querySelector('.aqs-host'), 'canvas or host left after exit');
      assert(W.__aqSaver === false, '__aqSaver not cleared');
      assert(W.snSaver.debug() === null, 'debug after exit');
    } finally {
      for (const [k, v] of Object.entries(keep)) { if (v) Object.defineProperty(g, k, v); else delete g[k]; }
      dom.window.close();
    }
  });
}

console.log(`\nsaver: ${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail ? 1 : 0);
