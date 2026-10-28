// ============================================================================
//  ALPHA QUDITS  ·  compare/tests.mjs  ·  node tests of the COMPARE package
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/alpha-qudits/compare/tests.mjs
//  With jsdom and MathJax (the DOM boot and the TeX check):
//        NODE_PATH=<dir>/node_modules node .../compare/tests.mjs
//  No browser runs. Sections:
//    facts ...... the stub against MODEL, the sigma offsets, Table S5 rows
//    scenes ..... every scene drawn with a mock 2D context at five widths
//                 and five times: all numbers finite, every text anchor
//                 inside the canvas, no canvas text under 11 px
//    saver ...... saverShots shape, renderShot into 16:9 and 9:16 boxes
//    look ....... one look-elsewhere run through the page fallback
//    dom ........ createCompare in jsdom: show, play, pause, resize, dispose
//    tex ........ every saverShots TeX string typesets in MathJax
//
//  grep -n targets:  function mockContext | section('scenes') | section('dom')
// ============================================================================
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0, skipped = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };
const skip = m => { skipped++; console.log('  skip ' + m); };
const section = s => console.log('# ' + s);

function findReq(name) {
  const dirs = (process.env.NODE_PATH || '').split(':').filter(Boolean);
  for (const d of dirs) for (const base of [join(d, 'x.js'), join(d, '..', 'x.js')]) {
    try { const req = createRequire(base); req.resolve(name); return req; } catch (e) { /* next */ }
  }
  return null;
}

// A 2D context that draws nothing. It keeps the transform and records each
// fillText with its frame position, its font size and its alignment, and
// the first NaN argument of any call.
function mockContext() {
  let m = [1, 0, 0, 1, 0, 0]; const stack = [], texts = []; let nan = null;
  const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const grad = { addColorStop() {} };
  const state = { font: '12px sans-serif', textAlign: 'left', globalAlpha: 1, lineWidth: 1, fillStyle: '#000', strokeStyle: '#000', textBaseline: 'alphabetic' };
  const px = () => parseFloat((/(\d+(?:\.\d+)?)px/.exec(state.font) || [0, 12])[1]);
  const fns = {
    save() { stack.push({ m: m.slice(), font: state.font, textAlign: state.textAlign, globalAlpha: state.globalAlpha }); },
    restore() { const s = stack.pop(); if (s) { m = s.m; state.font = s.font; state.textAlign = s.textAlign; state.globalAlpha = s.globalAlpha; } },
    setTransform(a, b, c, d, e, f) { m = [a, b, c, d, e, f]; },
    resetTransform() { m = [1, 0, 0, 1, 0, 0]; },
    translate(x, y) { m = mul(m, [1, 0, 0, 1, x, y]); }, scale(x, y) { m = mul(m, [x, 0, 0, y, 0, 0]); },
    rotate(r) { const c = Math.cos(r), s = Math.sin(r); m = mul(m, [c, s, -s, c, 0, 0]); },
    fillText(t, x, y) { texts.push({ t: String(t), x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5], px: px() * Math.hypot(m[0], m[1]), align: state.textAlign, a: state.globalAlpha }); },
    measureText(t) { return { width: String(t).length * px() * 0.55, actualBoundingBoxAscent: px() * 0.75, actualBoundingBoxDescent: px() * 0.2 }; },
    createLinearGradient: () => grad, createRadialGradient: () => grad, createConicGradient: () => grad, createPattern: () => null,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)) }),
    isPointInPath: () => false, getLineDash: () => [],
  };
  const watch = (k, a) => { if (!nan) for (const v of a) if (typeof v === 'number' && Number.isNaN(v)) { nan = `${String(k)}(${a.join(', ')})`; break; } };
  return new Proxy(state, {
    get(o, k) {
      if (k === '__texts') return texts;
      if (k === '__nan') return nan;
      if (k === 'canvas') return { width: 1920, height: 1080 };
      if (k in fns) return (...a) => { watch(k, a); return fns[k](...a); };
      if (k in o) return o[k];
      return (...a) => { watch(k, a); };
    },
    set(o, k, v) { if (typeof v === 'number' && Number.isNaN(v) && !nan) nan = `${String(k)} = NaN`; o[k] = v; return true; },
  });
}
// Text that is drawn (alpha above 0.05) and leaves the box by more than
// slack px. The extent uses 0.55 em per character, as saver/probe.js does.
function outside(texts, box, slack = 4) {
  return texts.filter(q => {
    if (q.a <= 0.05 || !q.t.trim()) return false;
    const w = q.t.length * q.px * 0.5;
    const x0 = q.align === 'center' ? q.x - w / 2 : q.align === 'right' || q.align === 'end' ? q.x - w : q.x;
    return x0 < box.x - slack || x0 + w > box.x + box.w + slack || q.y < box.y - slack || q.y > box.y + box.h + slack;
  });
}

const D = await import('./data.js');
const IDX = await import('./index.js');
let M = null;
try { M = await import('../model/index.js'); } catch (e) { skip('model/index.js does not load: ' + e.message); }

// ---------------------------------------------------------------- facts
section('facts');
const stub = D.facts();
ok(!stub.ready && stub.cand.inv === D.STUB.inv && stub.meas.length === 4, 'facts() before MODEL is the CONTRACT stub');
await D.loadModel();
const F = D.facts();
ok(F.ready === !!M, `facts() after loadModel() uses MODEL (${F.ready})`);
if (M) {
  ok(F.cand.inv.startsWith(D.STUB.inv), 'the stub digits are a prefix of MODEL inverseDigits(60)');
  ok(F.cand.inv.length === 4 + 60, `60 decimals (${F.cand.inv.length - 4})`);
  ok(JSON.stringify(F.cand.num) === JSON.stringify(D.STUB.num) && Number(F.cand.den) === D.STUB.den, 'numerator 79, 48, 42, 3 over 31104');
  const want = { codata2022: 0.60, g2: 1.57, rb2020: -1.49, cs2018: 5.32 };
  for (const m of F.meas) ok(Math.abs(m.sigma - want[m.id]) < 0.006, `${m.label}: ${D.fmtSigma(m.sigma)} (contract ${want[m.id]})`);
  ok(F.meas.map(m => m.id).join() === 'g2,rb2020,cs2018,codata2022', 'ruler order follows the paper\'s Fig. 3');
  for (const s of D.STUB.meas) { const m = F.meas.find(x => x.id === s.id); ok(m && m.value === s.value && m.unc === s.unc, `stub ${s.id} equals MODEL`); }
  ok(F.records === 172 && F.N === 31104, `records ${F.records}, N ${F.N}`);
  const alt = k => F.alts.find(a => a.key === k);
  const printed = { endsSwapped: 135.894, bothAtQubit: 146.524, bothAtQutrit: 127.536, xWhereLettersSit: 139.030, qqMovedByY: 134.485, copiesSeparate: 112.423, noOwnSign: 139.713, commutatorsXOnly: 138.348, noCommutators: 141.621, born: 97.505, perRecord: 0.758, noWeights: 180.837 };
  for (const [k, v] of Object.entries(printed)) {
    const a = alt(k);
    ok(a && Math.abs(a.inv - v) < 0.0006, `Table S5 ${k}: ${a ? a.inv.toFixed(3) : 'missing'} (printed ${v})`);
  }
  const sd = alt('sumsAndDiffs');
  ok(sd && sd.agrees === false && sd.paper && Math.abs(sd.paper.inv - 132.739) < 0.0006 && Math.abs(sd.inv - 133.969) < 0.0006, 'sums and differences: printed 132.739 and ours 133.969, both kept, agrees false');
  const re = alt('readEnds');
  ok(re && re.fromPaper && Math.abs(re.inv - 70.190) < 0.0006, `count of read ends: the printed row 70.190 marked fromPaper (${re && re.inv})`);
  ok(F.wyler > 137.0360824 && F.wyler < 137.0360825, `Wyler 1/alpha ${F.wyler}`);
}

// ---------------------------------------------------------------- scenes
section('scenes');
ok(JSON.stringify(IDX.SCENES) === JSON.stringify(['ruler', 'digits', 'dials', 'lookElsewhere', 'roles', 'history']), `scenes ${IDX.SCENES.join(' ')}`);
const PARAMS = {
  ruler: [{ z: 0 }, { z: 0.5 }, { z: 1 }, { auto: true }],
  digits: [{}],
  dials: [{ key: 'computed' }, { key: 'born' }, { key: 'sumsAndDiffs' }, { key: 'readEnds' }, { key: 'perRecord' }, { tour: true }],
  lookElsewhere: [{ autorun: false }],
  roles: [{ auto: true }, { role: 'dress' }, { role: 'pole' }],
  history: [{ step: 'eddington' }, { step: 'wyler' }, { step: 'rejoinders' }, { step: 'measurements' }, { step: 'candidate' }],
};
const WIDTHS = [296, 320, 360, 600, 860], TIMES = [0, 1.5, 4, 9, 20];
let frames = 0;
for (const [id, list] of Object.entries(PARAMS)) {
  const mod = IDX.SCENE_MODULES[id];
  for (const params of list) {
    for (const w of WIDTHS) {
      const st = mod.init({ params, reduced: false, fill: false });
      const h = mod.height(w, st);
      ok(Number.isFinite(h) && h > 100 && h < 1400, `${id} ${JSON.stringify(params)} height at ${w}: ${h}`);
      const bad = [], small = [];
      let nan = null;
      for (const t of TIMES) {
        const g = mockContext();
        mod.draw(g, { x: 0, y: 0, w, h }, t, st, F);
        frames++;
        if (g.__nan && !nan) nan = g.__nan;
        for (const q of outside(g.__texts, { x: 0, y: 0, w, h })) bad.push(`t${t} "${q.t.slice(0, 40)}" at ${q.x.toFixed(0)},${q.y.toFixed(0)}`);
        for (const q of g.__texts) if (q.a > 0.05 && q.t.trim() && q.px < 10.99) small.push(`"${q.t.slice(0, 20)}" ${q.px}px`);
      }
      ok(!nan, `${id} ${JSON.stringify(params)} at ${w}: no NaN` + (nan ? ` (${nan})` : ''));
      ok(!bad.length, `${id} ${JSON.stringify(params)} at ${w}: text inside the canvas` + (bad.length ? ` (${[...new Set(bad)].slice(0, 3).join('; ')})` : ''));
      ok(!small.length, `${id} ${JSON.stringify(params)} at ${w}: no text under 11 px` + (small.length ? ` (${[...new Set(small)].slice(0, 3).join('; ')})` : ''));
      if (mod.caption) { const c = mod.caption(st, F); ok(typeof c === 'string' && c.length > 10, `${id} caption`); }
      if (mod.info) { const i = mod.info(st, F); ok(typeof i === 'string', `${id} info`); }
    }
  }
}
console.log(`  ${frames} frames drawn`);
{
  // The stance on the comparison scenes: the conjecture is named.
  const st = IDX.SCENE_MODULES.ruler.init({ params: { z: 1 }, reduced: false, fill: false });
  const txt = (IDX.SCENE_MODULES.ruler.info ? IDX.SCENE_MODULES.ruler.info(st, F) : '') + IDX.SCENE_MODULES.history.info(IDX.SCENE_MODULES.history.init({ params: { step: 'candidate' } }), F);
  ok(/[Cc]onjecture/.test(txt), 'ruler and history info name the conjecture');
  const r = IDX.SCENE_MODULES.roles;
  ok(/no record is a Feynman diagram/.test(r.info(r.init({ params: {} }), F)), 'roles info keeps the paper\'s warning');
}

// ---------------------------------------------------------------- saver
section('saver');
const shots = IDX.saverShots;
ok(shots.length === 10 && new Set(shots.map(s => s.id)).size === 10, `${shots.length} saver shots with unique ids`);
ok(shots.every(s => IDX.SCENES.includes(s.scene) && s.seconds >= 5 && s.seconds <= 12 && s.title && s.caption && s.tex), 'every shot has a scene, 5-12 s, title, caption and TeX');
for (const box of [{ x: 0, y: 140, w: 1920, h: 700 }, { x: 0, y: 200, w: 608, h: 600 }, { x: 0, y: 160, w: 390, h: 520 }]) {
  let nan = null;
  for (const s of shots) for (const t of [0, 3, 8]) { const g = mockContext(); IDX.renderShot(g, s, t, box); if (g.__nan && !nan) nan = `${s.id} ${g.__nan}`; }
  ok(!nan, `renderShot into ${box.w}x${box.h}: no NaN` + (nan ? ` (${nan})` : ''));
}
{
  // The digits shot in a short band keeps its text inside the band.
  const s = shots.find(x => x.scene === 'digits');
  const box = { x: 0, y: 0, w: 390, h: 300 };
  const g = mockContext(); IDX.renderShot(g, { ...s, id: s.id + '#t' }, 12, box);
  const out = outside(g.__texts, box);
  ok(!out.length, 'digits shot fits a 390 x 300 band' + (out.length ? ` (${out.slice(0, 2).map(q => q.t).join('; ')})` : ''));
}

// ---------------------------------------------------------------- look
section('look');
if (M && M.startLookElsewhere) {
  const job = M.startLookElsewhere({ coeffMax: 100, denominators: { kind: 'smooth', max: 40000 }, window: 1 }, {});
  const r = await job.promise;
  ok(r && r.hits === 1 && Math.abs(r.expected - 0.18) < 0.005, `3-smooth D: ${r && r.hits} hit, lambda ${r && r.expected.toFixed(3)} (c10 quotes 1 and 0.18)`);
  const look = IDX.SCENE_MODULES.lookElsewhere;
  const st = look.init({ params: { autorun: false }, reduced: false, fill: false });
  st.status = 'done'; st.result = r;
  ok(/Found 1 distinct value/.test(look.caption(st, F)), 'look caption reads the result');
} else skip('startLookElsewhere not available');

// ---------------------------------------------------------------- dom
section('dom');
{
  const req = findReq('jsdom');
  if (!req) skip('jsdom not on NODE_PATH');
  else {
    const { JSDOM } = req('jsdom');
    const dom = new JSDOM('<!doctype html><html><head></head><body><div id="h" style="width:360px"></div></body></html>', { pretendToBeVisual: true });
    const w = dom.window;
    w.HTMLCanvasElement.prototype.getContext = function () { return this.__g || (this.__g = mockContext()); };
    const raf = [];
    w.requestAnimationFrame = fn => { raf.push(fn); return raf.length; };
    w.cancelAnimationFrame = () => {};
    const host = w.document.getElementById('h');
    host.getBoundingClientRect = () => ({ width: 360, height: 0, left: 0, top: 0 });
    let err = null, inst = null;
    try { inst = IDX.createCompare(host, { scene: 'ruler', reduced: false, notes: false }); } catch (e) { err = e; }
    ok(!err && inst, 'createCompare mounts' + (err ? ': ' + err.message : ''));
    if (inst) {
      await inst.ready;
      for (let i = 0; i < 5; i++) { const q = raf.splice(0); q.forEach(fn => fn(1000 + i * 16)); }
      ok(host.querySelectorAll('button').length >= 2 && [...host.querySelectorAll('button')].every(b => b.type === 'button'), 'scene controls are buttons');
      for (const id of IDX.SCENES) {
        let e2 = null;
        try { inst.show(id, id === 'lookElsewhere' ? { autorun: false } : {}); inst.play(2); inst.play(5); } catch (e) { e2 = e; }
        ok(!e2 && inst.current().scene === id, `show(${id}) and play(t)` + (e2 ? ': ' + e2.message : ''));
        ok(host.querySelector('.cmp-cap').textContent.length > 10, `${id} writes its caption`);
      }
      // a 270 px card on a 320 px phone: the drawing is 270 px wide, not squeezed from 280
      host.getBoundingClientRect = () => ({ width: 270, height: 0, left: 0, top: 0 });
      inst.resize();
      const cv = host.querySelector('canvas'), dpr = Math.min(2, w.devicePixelRatio || 1);
      ok(cv.width === Math.round(270 * dpr), `a 270 px card: canvas ${cv.width} px at dpr ${dpr}`);
      host.getBoundingClientRect = () => ({ width: 360, height: 0, left: 0, top: 0 });
      inst.pause(); inst.resume(); inst.resize(); inst.setBand({ t: 100, b: 200 }); inst.setBand(null);
      inst.dispose();
      ok(!host.querySelector('.cmp-fig'), 'dispose() removes the figure');
    }
  }
}

// ---------------------------------------------------------------- tex
section('tex');
{
  const req = findReq('mathjax-full/js/mathjax.js');
  if (!req) skip('mathjax-full not on NODE_PATH');
  else {
    const { mathjax } = req('mathjax-full/js/mathjax.js');
    const { TeX } = req('mathjax-full/js/input/tex.js');
    const { SVG } = req('mathjax-full/js/output/svg.js');
    const { liteAdaptor } = req('mathjax-full/js/adaptors/liteAdaptor.js');
    const { RegisterHTMLHandler } = req('mathjax-full/js/handlers/html.js');
    req('mathjax-full/js/input/tex/AllPackages.js');
    const adaptor = liteAdaptor(); RegisterHTMLHandler(adaptor);
    const doc = mathjax.document('', { InputJax: new TeX({ packages: ['base', 'ams', 'html', 'color', 'newcommand', 'noundefined'], formatError: (j, e) => { throw e; } }), OutputJax: new SVG({ fontCache: 'none' }) });
    const bad = [];
    for (const s of shots) {
      try { const out = adaptor.outerHTML(doc.convert(s.tex, { display: true })); if (/merror|data-mjx-error/.test(out)) bad.push(s.id); } catch (e) { bad.push(`${s.id} (${e.message})`); }
    }
    ok(!bad.length, `${shots.length} saver TeX strings typeset` + (bad.length ? `: ${bad.join('; ')}` : ''));
  }
}

console.log(`\ncompare: ${pass} passed, ${fail} failed, ${skipped} skipped`);
process.exit(fail ? 1 : 0);
