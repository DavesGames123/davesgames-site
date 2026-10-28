// ============================================================================
//  ALPHA QUDITS  ·  records/tests.mjs  ·  node tests of the RECORDS package
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/alpha-qudits/records/tests.mjs
//  With jsdom and MathJax (the DOM boot and the TeX check):
//        NODE_PATH=<dir>/node_modules node .../records/tests.mjs
//  No browser runs. Sections:
//    counts ..... every count the figures show, against the paper's print
//    mirror ..... the verdicts the mirror scene shows, per sample record
//    scenes ..... every scene and step drawn with a mock 2D context at 320,
//                 360 and 860 px and in the saver fill mode; all numbers
//                 finite; all text inside the canvas
//    source ..... no published count typed into the package source
//    dom ........ createRecords in jsdom: show, play, tap, resize, buttons
//    tex ........ every saverShots TeX string typesets in MathJax
// ============================================================================
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0, skipped = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };
const skip = m => { skipped++; console.log('  skip ' + m); };
const section = s => console.log('# ' + s);

const D = await import('./data.js');

// ---------------------------------------------------------------- counts
section('counts');
ok(D.RECORDS.length === 172, 'records: 172');
ok(JSON.stringify(D.SECTORS) === JSON.stringify({ '++': 79, '+-': 48, '-+': 42, '--': 3 }), 'sectors 79 / 48 / 42 / 3');
ok(D.SECTOR_ROWS.map(s => s.k).join() === '1,2,3,6' && D.SECTOR_ROWS.every(s => s.ks.length === 1), 'one k per sector: 1, 2, 3, 6');
ok(D.SLOTS.map(s => s.id + s.letters).join() === 'Q18,q13,Q28,q23', 'slots (8, 3, 8, 3) in the order Q1 q1 Q2 q2');
ok(D.EDGES.filter(e => !e.arc).map(e => e.products).sort((a, b) => a - b).join() === '9,24,24,24,24,64', 'edge products 64, 9 and four of 24');
ok(D.PRODUCT_TERMS === 169 && D.SAME_END_TERMS === 73 && D.MIXED_TERMS === 96 && D.SELF_TERMS === 11, '169 products: 73 same-end, 96 mixed, 11 fixed by the swap');
ok(D.EDGES.find(e => e.arc).records === 3 && D.COMMUTATORS.length === 3, '3 commutator records on the arc');
ok(D.READOUT.N === 31104 && D.READOUT.unread === 24 && D.READOUT.read.join() === '36,36', 'N = 24 · 36 · 36 = 31104');
ok(JSON.stringify(D.TOTAL.counts) === JSON.stringify({ 1: 79, 2: 48, 3: 42, 6: 3 }), 'abacus totals per k');
ok(Math.abs(D.TOTAL.sum - (79 + 48 * Math.SQRT2 + 42 * Math.sqrt(3) + 3 * Math.sqrt(6))) < 1e-9, 'abacus sum = 79 + 48√2 + 42√3 + 3√6');
ok(Math.abs(D.READOUT.N / D.TOTAL.sum - 137.0359991895661) < 1e-9, 'N / sum = 137.03599918956…');
ok(D.VALUE.inverseDigits(30) === '137.035999189566155029183744020866', 'exact digits to 30 places (contract)');
ok(Math.abs(D.ALT.born.inverse - 97.505) < 5e-4 && Math.abs(D.ALT.noWeights.inverse - 180.837) < 5e-4, 'Born 97.505, no weights 180.837');
ok(Math.abs(D.SIGMA.find(s => s.id === 'codata2022').sigma - 0.60) < 0.005, 'CODATA 2022 offset +0.60 sigma');
ok(D.oneMore(1) < -0.59 && D.oneMore(1) > -0.61, 'one more record at weight 1 moves 1/alpha by about -0.60');
for (const n of [3, 8]) {
  const mc = D.modeCounts(n);
  ok(mc.even + mc.odd === n * n && mc.even - mc.odd === n, `modeCounts(${n}): even + odd = n^2, even - odd = n`);
}
const sQ = D.edgeSplit('Q1Q2'), sq = D.edgeSplit('q1q2'), sD = D.edgeSplit(['Q1q1', 'Q2q2', 'Q1q2', 'q1Q2']);
ok(sQ.self + sQ.even === D.modeCounts(8).even && sQ.odd === D.modeCounts(8).odd && sQ.ks[3] === 36 && sQ.ks[1] === 28, 'plate with 8 letters matches edge Q1Q2: 36 at √3, 28 at 1');
ok(sq.self + sq.even === D.modeCounts(3).even && sq.odd === D.modeCounts(3).odd && sq.ks[3] === 6 && sq.ks[1] === 3, 'plate with 3 letters matches edge q1q2: 6 at √3, 3 at 1');
ok(sD.records === 96 && sD.even === 48 && sD.odd === 48 && sD.ks[2] === 48, 'two drums match the dashed edges: 48 even at √2, 48 odd');
ok(D.RECORDS.every(r => r.terms.every(t => t.slots.every((s, i) => t.letters[i] >= 0 && t.letters[i] < D.SLOT[s].letters))), 'every letter index fits its slot');
ok(D.recordText(D.RECORDS[0]).name.includes(' at Q1') && D.recordText(D.COMMUTATORS[0]).name.startsWith('['), 'record names in plain text');

// ---------------------------------------------------------------- mirror
section('mirror');
for (const step of ['self', 'pair', 'mixed', 'commutator']) ok(D.samples(step).length > 0, `samples(${step}) not empty`);
ok(D.samples('self').every(r => r.X === -1 && r.Y === 1 && r.k === 3), 'own images survive X only: k = 3');
ok(D.samples('pair').every(r => r.X === -1 && D.oddPartner(r).X === 1 && D.oddPartner(r).combo === 'odd'), 'same-end even survives X, its odd partner does not');
ok(D.samples('mixed').every(r => r.Y === -1 && r.X === 1 && r.k === 2 && D.oddPartner(r).Y === 1 && D.oddPartner(r).k === 1), 'mixed even survives Y (k = 2), odd reads +1 (k = 1)');
ok(D.samples('commutator').every(r => r.X === -1 && r.Y === -1 && r.k === 6 && r.ownSign === -1), 'commutators survive both, own sign -1, k = 6');

// ---------------------------------------------------------------- scenes
section('scenes');
function mockCtx(W, H, sink) {
  const state = { font: '12px sans', textAlign: 'start' };
  const fsz = () => { const m = /(\d+(?:\.\d+)?)px/.exec(state.font); return m ? +m[1] : 12; };
  const bad = [];
  const check = (name, args) => { for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) bad.push(name); };
  const grad = { addColorStop() {} };
  const fns = {
    measureText: s => ({ width: String(s).length * fsz() * 0.55 }),
    createLinearGradient: (...a) => { check('grad', a); return grad; },
    createRadialGradient: (...a) => { check('rgrad', a); return grad; },
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    fillText: (s, x, y) => {
      check('fillText', [x, y]);
      const w = String(s).length * fsz() * 0.55;
      const a = state.textAlign, L = a === 'center' ? x - w / 2 : a === 'right' || a === 'end' ? x - w : x;
      sink.text.push({ s: String(s), L, R: L + w, y, alpha: state.globalAlpha ?? 1 });
    },
    strokeText: (s, x, y) => check('strokeText', [x, y]),
    setLineDash() {}, getLineDash: () => [],
    save() { sink.depth++; }, restore() { sink.depth--; },
  };
  return new Proxy({}, {
    get(_, k) {
      if (k in fns) return fns[k];
      if (k in state) return state[k];
      if (k === 'canvas') return { width: W, height: H };
      return (...a) => { check(String(k), a); sink.calls++; };
    },
    set(_, k, v) { state[k] = v; if (typeof v === 'number' && !Number.isFinite(v)) bad.push('set ' + String(k)); return true; },
    has() { return true; },
  });
  // (bad is read through sink)
}
const IDX = await import('./index.js');
const MODS = IDX.SCENE_MODULES;
ok(IDX.SCENES.join() === 'square,mirror,modes,grid,abacus', 'the five contract scenes');
for (const name of IDX.SCENES) {
  const mod = MODS[name];
  ok(mod.analogy && mod.analogy.right.length > 80 && mod.analogy.breaks.length > 80, `${name}: analogy says what it gets right and where it breaks`);
  ok(mod.steps.every(s => s.dur > 0 && s.label && s.label[0] === s.label[0].toUpperCase()), `${name}: steps have labels and durations`);
  for (const W of [320, 360, 860]) {
    const H = mod.height(W);
    ok(H >= 200 && H <= 900, `${name} @${W}: height ${H}`);
    for (const fill of [false]) {
      const view = { x: 0, y: 0, w: W, h: H };
      const HH = H;
      for (const step of mod.steps) {
        const sink = { text: [], calls: 0, depth: 0 };
        const g = mockCtx(W, HH, sink);
        const st = mod.init({});
        st.step = step.id; st.auto = false; st.since = 0; st.stepSince = 0;
        let threw = null;
        const ts = [0, 0.3, 1, 2, 3.2, 4.5, 6, 8, step.dur * 0.75, step.dur - 0.05];
        try {
          for (const t of ts) {
            st.stepT = t; st.stepDur = step.dur; st.cycle = 0;
            mod.draw(g, { W, H: HH, dpr: 1, fill, reduced: false, view }, st, t);
            if (mod.caption) mod.caption(st, t);
          }
        } catch (e) { threw = e; }
        ok(!threw, `${name}/${step.id} @${W}${fill ? ' fill' : ''}: draws` + (threw ? ' ' + threw.stack.split('\n').slice(0, 3).join(' | ') : ''));
        ok(sink.depth === 0, `${name}/${step.id} @${W}: save/restore balanced (${sink.depth})`);
        ok(sink.calls > 20, `${name}/${step.id} @${W}: draws something (${sink.calls} calls)`);
        const out = sink.text.filter(q => q.alpha > 0.05 && (q.L < view.x - 2 || q.R > view.x + view.w + 2 || q.y < view.y - 4 || q.y > view.y + view.h + 4));
        ok(!out.length, `${name}/${step.id} @${W}${fill ? ' fill' : ''}: text inside the canvas` + (out.length ? ' ' + JSON.stringify(out.slice(0, 2)) : ''));
      }
    }
  }
  // the saver fill: portrait 9:16 phone bands and landscape 16:9 bands
  for (const [w, h] of [[390, 844 * 0.55], [360, 640 * 0.55], [1280, 720 * 0.55], [1920, 1080 * 0.5]]) {
    const f = IDX.fitScene(mod, w, h);
    ok(f.Wn * f.s <= w + 0.5 && f.Hn * f.s <= h + 0.5 && f.ox >= -0.5 && f.oy >= -0.5, `${name} fill ${w}x${Math.round(h)}: fits (natural ${f.Wn}x${f.Hn}, scale ${f.s.toFixed(2)})`);
    ok(f.s >= (w < 500 ? 0.55 : 0.5), `${name} fill ${w}x${Math.round(h)}: scale ${f.s.toFixed(2)} keeps the subject large`);
  }
  const c = mod.steps.map(s => { const st = mod.init({}); st.step = s.id; st.stepT = 5; st.cycle = 0; return mod.caption(st, 5); });
  ok(c.every(x => typeof x === 'string' && x.length > 30), `${name}: a caption per step`);
}
ok(IDX.saverShots.length >= 8 && IDX.saverShots.every(s => IDX.STEPS[s.scene] && IDX.STEPS[s.scene].includes(s.params.step) && s.seconds >= 5 && s.seconds <= 12 && s.tex && s.caption), 'saverShots name real scenes and steps, 5-12 s each');
ok(new Set(IDX.saverShots.map(s => s.id)).size === IDX.saverShots.length, 'saverShots ids unique');
ok(IDX.saverShots.find(s => s.id === 'records-grid-sectors').tex === '79+48+42+3=172', 'saver TeX computed from the model: 79+48+42+3=172');
ok(IDX.saverShots.find(s => s.id === 'records-abacus-divide').tex === '\\frac{79+48\\sqrt{2}+42\\sqrt{3}+3\\sqrt{6}}{31104}', 'saver TeX of Eq. (6) computed from the model');

// ---------------------------------------------------------------- source
section('source');
const files = ['index.js', 'data.js', 'draw.js', 'style.js', ...readdirSync(join(HERE, 'scenes')).map(f => 'scenes/' + f)];
for (const f of files) {
  const src = readFileSync(join(HERE, f), 'utf8');
  const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const hits = code.match(/(?<![\w.#-])(79|48|42|172|31104|169|73|96)(?![\w.])/g);
  ok(!hits, `${f}: no published count typed in` + (hits ? ' (' + hits.join(',') + ')' : ''));
  ok(!/uppercase|letter-spacing/i.test(code.replace(/no uppercase, no letter-spacing/g, '')), `${f}: no uppercase or letter-spaced text`);
  ok(!/KaTeX|katex|Playfair|Cormorant|JetBrains/.test(src), `${f}: no KaTeX, no banned fonts`);
}
const css = readFileSync(join(HERE, 'style.js'), 'utf8');
ok(/min-height:44px/.test(css) && /min-width:44px/.test(css), 'buttons are 44 px targets');

// ---------------------------------------------------------------- dom
section('dom');
const req = createRequire(import.meta.url);
let JSDOM = null;
try { ({ JSDOM } = req('jsdom')); } catch { /* none */ }
if (!JSDOM) skip('jsdom not found on NODE_PATH: DOM boot not run');
else {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="h"></div></body></html>', { pretendToBeVisual: true });
  const w = dom.window;
  globalThis.window = w; globalThis.document = w.document; globalThis.devicePixelRatio = 2;
  globalThis.requestAnimationFrame = f => setTimeout(() => f(Date.now()), 16);
  globalThis.cancelAnimationFrame = id => clearTimeout(id);
  const sink = { text: [], calls: 0, depth: 0 };
  w.HTMLCanvasElement.prototype.getContext = function () { return mockCtx(this.width, this.height, sink); };
  w.HTMLElement.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: 340, height: 600, right: 340, bottom: 600 }; };
  const host = w.document.getElementById('h');
  let inst = null, err = null;
  try { inst = IDX.createRecords(host, { scene: 'square', reduced: false, notes: false }); } catch (e) { err = e; }
  ok(inst && !err, 'createRecords mounts' + (err ? ' ' + err.stack : ''));
  if (inst) {
    ok(['show', 'play', 'pause', 'resume', 'resize', 'dispose', 'setBand'].every(k => typeof inst[k] === 'function'), 'instance has the CORE API');
    ok(w.document.getElementById('records-css'), 'CSS injected once');
    for (const s of IDX.SCENES) {
      let e2 = null;
      try { inst.show(s, {}); for (const t of [0, 1, 4, 9, 20, 40]) inst.play(t); } catch (e) { e2 = e; }
      ok(!e2, `show(${s}) + play(t)` + (e2 ? ' ' + e2.stack : ''));
      const btn = host.querySelectorAll('button');
      ok(btn.length >= 2, `${s}: step buttons (${btn.length})`);
      const c = host.querySelector('canvas');
      ok(+c.style.width.replace('px', '') === 340 && c.width === 680, `${s}: canvas 340 css px at dpr 2`);
    }
    ok(!host.querySelector('.rec-notes'), 'notes: false hides the analogy notes');
    // a 270 px card on a 320 px phone: the canvas must not be wider than the card
    {
      const keepRect = w.HTMLElement.prototype.getBoundingClientRect;
      w.HTMLElement.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: 270, height: 600, right: 270, bottom: 600 }; };
      inst.resize();
      const c = host.querySelector('canvas');
      ok(c.style.width === '270px' && c.width === 540, `a 270 px card: canvas ${c.style.width} at ${c.width} px`);
      w.HTMLElement.prototype.getBoundingClientRect = keepRect; inst.resize();
    }
    inst.show('grid', { step: 'sectors' });
    inst.play(5);
    // tap a record cell: the first cell of the first group
    const c = host.querySelector('canvas');
    c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 340, height: 600 });
    const ev = (type, x, y) => { const e = new w.Event(type); Object.assign(e, { pointerId: 1, clientX: x, clientY: y, pointerType: 'touch' }); c.dispatchEvent(e); };
    ev('pointerdown', 25, 43); ev('pointerup', 25, 43);
    const cur = inst.current();
    ok(cur && cur.sel != null, 'a tap selects a record (' + (cur && cur.sel) + ')');
    inst.play(7);
    ok(/Record \d+/.test(host.querySelector('.rec-cap').textContent), 'the caption names the tapped record');
    // a step button switches the step and stops the tour
    inst.show('mirror', {});
    const b = [...host.querySelectorAll('button')].find(x => x.textContent === 'Commutator');
    b.click(); inst.play(50);
    ok(inst.current().step === 'commutator' && inst.current().auto === false, 'a step button picks the step');
    const nb = [...host.querySelectorAll('button')].find(x => x.textContent === 'Another record');
    nb.click(); inst.play(51);
    ok(/commutator/.test(host.querySelector('.rec-cap').textContent), 'Another record keeps the step');
    inst.setBand({ t: 80, b: 120 }); inst.play(52);
    inst.dispose();
    ok(!host.querySelector('.rec-fig'), 'dispose removes the DOM');
    const h2 = w.document.createElement('div'); w.document.body.appendChild(h2);
    const f = IDX.createRecords(h2, { fill: true, scene: 'abacus', params: { step: 'divide' } });
    f.play(6);
    ok(!h2.querySelector('button') && !h2.querySelector('.rec-cap'), 'fill mode: no controls, no text');
    f.dispose();
  }
}

// ---------------------------------------------------------------- tex
section('tex');
let mj = null;
try { mj = req('mathjax-full/js/mathjax.js'); } catch { /* none */ }
if (!mj) skip('mathjax-full not found on NODE_PATH: TeX check not run');
else {
  const { TeX } = req('mathjax-full/js/input/tex.js');
  req('mathjax-full/js/input/tex/AllPackages.js');
  const { SVG } = req('mathjax-full/js/output/svg.js');
  const { liteAdaptor } = req('mathjax-full/js/adaptors/liteAdaptor.js');
  const { RegisterHTMLHandler } = req('mathjax-full/js/handlers/html.js');
  const adaptor = liteAdaptor(); RegisterHTMLHandler(adaptor);
  const doc = mj.mathjax.document('', { InputJax: new TeX({ packages: ['base', 'ams', 'html', 'color', 'newcommand', 'noundefined'], formatError: (j, err) => { throw err; } }), OutputJax: new SVG({ fontCache: 'none' }) });
  for (const s of IDX.saverShots) {
    let html = '', e = null;
    try { html = adaptor.outerHTML(doc.convert(s.tex, { display: true })); } catch (x) { e = x; }
    ok(!e && !/merror|data-mjx-error|fill="red"/.test(html), `TeX of ${s.id} typesets` + (e ? ' ' + e.message : ''));
  }
}

console.log(`records: ${pass} passed, ${fail} failed${skipped ? ', ' + skipped + ' skipped' : ''}`);
process.exit(fail ? 1 : 0);
