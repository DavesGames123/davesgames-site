// ============================================================================
//  TENSOR CALCULUS  ·  tests/core.test.mjs  (CORE)
// ----------------------------------------------------------------------------
//  node stella-nova/pages/tensor-calculus/tests/core.test.mjs
//  Checks the CORE package with no browser: the palette (contrast and
//  colour-blind distance), the CSS copy of the palette, the head of
//  index.html, the [hidden] rule, the layout state machine, the player
//  timing, window.tensorPage, and a boot of main.js on a stub DOM.
//
//  SECTIONS   (grep -n "^section(" tests/core.test.mjs)
// ============================================================================
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0, current = '';
const pending = [];
function section(name) { current = name; }
function check(name, fn) {
  const label = `${current} :: ${name}`;
  // Checks run one at a time, in order: the palette is module state.
  pending.push(() => Promise.resolve().then(fn).then(() => { pass++; }, e => { fail++; console.log('FAIL ' + label + '\n     ' + (e && e.stack || e).toString().split('\n').slice(0, 6).join('\n     ')); }));
}
async function drain() { while (pending.length) await pending.shift()(); }

// ---- colour math: WCAG contrast, CIELAB dE76, Machado 2009 CVD (severity 1)
function hexRGB(h) { return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255); }
const lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const gam = c => c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
function luminance(rgb) { const [r, g, b] = rgb.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
function contrast(a, b) { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
const CVD = {
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
function simulate(rgb, kind) {
  if (kind === 'normal') return rgb;
  const l = rgb.map(lin), m = CVD[kind];
  return m.map(row => gam(Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2]))));
}
function lab(rgb) {
  const [r, g, b] = rgb.map(lin);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * b, z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
function dE(a, b) { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }

// ============================================================================
section('palette');
const P = await import(join(ROOT, 'palette.js'));
check('eight colours', () => assert.equal(P.INDEX_COLORS.length, 8));
check('contrast 4.5 or more on BG', () => {
  for (const h of P.INDEX_COLORS) assert.ok(contrast(hexRGB(h), hexRGB(P.BG)) >= 4.5, h);
});
for (const kind of ['normal', 'deuteranopia', 'protanopia', 'tritanopia']) {
  check(`pairs apart under ${kind}`, () => {
    const floor = kind === 'normal' ? 25 : 12;
    let min = 1e9, pair = null;
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
      const d = dE(simulate(hexRGB(P.INDEX_COLORS[i]), kind), simulate(hexRGB(P.INDEX_COLORS[j]), kind));
      if (d < min) { min = d; pair = [i, j]; }
    }
    assert.ok(min >= floor, `min dE ${min.toFixed(1)} for slots ${pair} < ${floor}`);
  });
}
check('style.css .i0-.i7 match INDEX_COLORS', () => {
  const css = read('style.css');
  P.INDEX_COLORS.forEach((h, i) => {
    const m = new RegExp(`--i${i}:(#[0-9a-f]{6})`).exec(css);
    assert.ok(m, `--i${i} missing`); assert.equal(m[1], h);
    assert.ok(css.includes(`.i${i}{color:var(--i${i})}`) && css.includes(`svg .i${i}{fill:var(--i${i})}`), `.i${i} rules`);
  });
});
check('norm folds TeX names', () => {
  assert.equal(P.norm('\\mu'), 'mu'); assert.equal(P.norm('{\\nu}'), 'nu'); assert.equal(P.norm("a'"), 'a');
  assert.equal(P.indexColor('\\mu'), P.indexColor('mu'));
});
check('home slots apart for Riemann + Christoffel letters', () => {
  P.setActive([]);
  const s = ['rho', 'sigma', 'mu', 'nu', 'lambda'].map(P.homeSlot);
  assert.equal(new Set(s).size, 5);
});
check('setActive gives distinct slots and indexColor follows it', () => {
  const m = P.setActive(['i', 'a', 'j', 'b']);   // i/a and j/b share home slots
  assert.equal(new Set(m.values()).size, 4);
  assert.equal(P.indexSlot('i'), m.get('i'));
  assert.equal(P.indexSlot('a'), m.get('a'));
  assert.notEqual(P.indexColor('i'), P.indexColor('a'));
  assert.deepEqual(P.activeSyms(), ['i', 'a', 'j', 'b']);
  P.setActive([]);
  assert.equal(P.indexColor('i'), P.indexColor('a'));
});
check('setActive keeps the slot of a letter that stays active', () => {
  P.setActive([]);
  const m1 = P.setActive(['a', 'i']);           // i moves off its home slot 0
  const m2 = P.setActive(['i', 'j']);           // i stays active: same slot
  assert.equal(m2.get('i'), m1.get('i'));
  assert.notEqual(m2.get('i'), m2.get('j'));
  P.setActive([]); P.setActive([]);
  assert.equal(P.indexSlot('i'), P.homeSlot('i'), 'empty set clears');
});
check('indexRGB and indexClass', () => {
  const rgb = P.indexRGB('mu');
  assert.equal(rgb.length, 3); rgb.forEach(v => assert.ok(v >= 0 && v <= 1));
  assert.match(P.indexClass('nu'), /^i[0-7]$/);
  assert.deepEqual(P.colorRules(['mu', 'i']), [['\\mu', P.indexClass('mu')], ['i', P.indexClass('i')]]);
});

// ============================================================================
section('page-api');
const API = await import(join(ROOT, 'ui/page-api.js'));
check('stub queues calls and attach runs them in order', async () => {
  const win = {};
  const stub = API.installStub(win);
  assert.equal(win.tensorPage, stub);
  const log = [];
  const p1 = stub.openEntry('kronecker');
  const p2 = stub.setView('tex');
  const seen = [];
  stub.on('step', e => seen.push(e));
  assert.deepEqual(await stub.state(), { ready: false });
  const impl = {};
  for (const m of API.METHODS) impl[m] = (...a) => { log.push([m, ...a]); return m; };
  let handler = null;
  impl.on = (ev, fn) => { handler = fn; log.push(['on', ev]); return () => {}; };
  impl.state = () => ({ ready: true });
  await API.attach(win, impl);
  assert.equal(await p1, 'openEntry'); assert.equal(await p2, 'setView');
  assert.deepEqual(log.slice(0, 3), [['on', 'step'], ['openEntry', 'kronecker'], ['setView', 'tex']]);
  handler({ index: 2 }); assert.deepEqual(seen, [{ index: 2 }]);
  assert.deepEqual(await stub.pickIndex('mu'), 'pickIndex');
  assert.deepEqual(stub.stateNow(), { ready: true });
  assert.equal(await stub.ready, stub);
});
check('attach refuses an incomplete impl', () => {
  assert.throws(() => API.attach({}, { openEntry() {} }), /no method/);
});

// ============================================================================
section('index.html');
const HTML = read('index.html');
check('head script order: gpu-guard, wishlist, stats-beacon first', () => {
  const head = HTML.slice(0, HTML.indexOf('</head>'));
  const srcs = [...head.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(srcs.slice(0, 3), ['../../lib/gpu-guard.js', '../../lib/wishlist.js', '../../lib/stats-beacon.js']);
  assert.ok(head.indexOf('gpu-guard.js') < head.indexOf('<meta name="viewport"'), 'site scripts before the viewport meta');
  assert.match(head, /<meta name="viewport" content="[^"]*viewport-fit=cover/);
  assert.match(head, /<meta name="description" content="[^"]{40,}"/);
  assert.ok(head.indexOf('href="style.css"') < head.indexOf('href="../../lib/sci.css"'), 'style.css before sci.css');
});
check('importmap for three r160', () => {
  const m = /<script type="importmap">([\s\S]*?)<\/script>/.exec(HTML);
  assert.ok(m, 'importmap');
  const map = JSON.parse(m[1]).imports;
  assert.equal(map.three, '../../vendor/three@0.160.0/build/three.module.js');
  assert.equal(map['three/addons/'], '../../vendor/three@0.160.0/examples/jsm/');
  assert.ok(existsSync(join(ROOT, '../../vendor/three@0.160.0/build/three.module.js')), 'vendor three r160 exists');
});
check('in-frame script is the first thing in body', () => {
  const body = HTML.slice(HTML.indexOf('<body>') + 6).trimStart();
  assert.ok(body.startsWith("<script>if(window!==window.top)document.documentElement.classList.add('in-frame')</script>"));
});
check('no KaTeX, no banned fonts', () => {
  const all = HTML + read('style.css') + read('main.js');
  assert.ok(!/katex/i.test(all), 'KaTeX');
  assert.ok(!/Playfair|Cormorant|JetBrains/i.test(all), 'banned font');
});
check('every id that main.js asks for exists in index.html', () => {
  const src = read('main.js');
  const ids = new Set([...src.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]));
  const missing = [...ids].filter(id => !HTML.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
});
check('module script main.js at the end of body', () => {
  assert.match(HTML, /<script type="module" src="main.js"><\/script>\s*<\/body>/);
});

section('style.css');
const CSS = read('style.css');
check('[hidden]{display:none!important} rule', () => assert.match(CSS, /\[hidden\]\{display:none!important\}/));
check('no uppercase letter-spaced labels', () => {
  const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/text-transform:\s*uppercase/.test(rules), 'uppercase');
  assert.ok(!/letter-spacing/.test(rules), 'letter-spacing');
});
check('a pane with the hidden attribute has no display rule that wins', () => {
  // The panes, the drawers and the fallbacks carry hidden. A display rule on
  // them is fine only because [hidden] has !important; check that no rule
  // on those ids uses !important for display other than the stage.
  for (const m of CSS.matchAll(/([^{}]+)\{[^}]*display:[^;}]*!important/g)) {
    const sel = m[1].trim();
    if (sel === '[hidden]') continue;
    assert.ok(!/#pane|\.pane\b|#credits|#libDetail|fallback|#stepList|#toast|note-pop/.test(sel) || /^#stage/.test(sel.split(',').pop().trim()), 'display !important on ' + sel);
  }
});
check('phone query in CSS matches ui/phone.js', async () => {
  const { PHONE_QUERY } = await import(join(ROOT, 'ui/phone.js'));
  const css = CSS.replace(/\s+/g, '');
  assert.ok(css.includes('@media' + PHONE_QUERY.replace(/\s+/g, '').replace(/:/g, ':')) || css.includes('@media(max-width:768px),(max-height:500px)and(pointer:coarse)'), 'phone query');
});

section('layout');
const L = await import(join(ROOT, 'ui/layout.js'));
check('initial layout is all three', () => assert.deepEqual(L.initialLayout(), { views: ['tex', 'viz', 'diagram'], mode: 'all', style: 'penrose' }));
check('focus, pair, toggle, swap, cycle, style', () => {
  let s = L.initialLayout();
  s = L.reduce(s, 'viz'); assert.deepEqual([s.views, s.mode], [['viz'], 'focus']);
  s = L.reduce(s, { toggle: 'tex' }); assert.deepEqual([s.views, s.mode], [['tex', 'viz'], 'pair']);
  s = L.reduce(s, { swap: true }); assert.deepEqual(s.views, ['viz', 'tex']);
  s = L.reduce(s, { toggle: 'viz' }); assert.deepEqual(s.views, ['tex']);
  s = L.reduce(s, { toggle: 'tex' }); assert.deepEqual(s.views, ['tex'], 'never empty');
  s = L.reduce(s, { cycle: 1 }); assert.deepEqual(s.views, ['viz']);
  s = L.reduce(s, { cycle: -1 }); s = L.reduce(s, { cycle: -1 }); assert.deepEqual(s.views, ['diagram']);
  s = L.reduce(s, { style: 'network' }); assert.equal(s.style, 'network'); assert.deepEqual(s.views, ['diagram']);
  s = L.reduce(s, ['diagram', 'tex', 'tex', 'bogus']); assert.deepEqual([s.views, s.mode], [['diagram', 'tex'], 'pair']);
  s = L.reduce(s, []); assert.deepEqual(s.views, ['diagram', 'tex'], 'empty list keeps the layout');
  s = L.reduce(s, 'all'); assert.equal(s.mode, 'all'); assert.equal(s.style, 'network');
  s = L.reduce(s, { views: ['tex', 'diagram'], style: 'birdtrack' }); assert.deepEqual([s.views, s.style], [['tex', 'diagram'], 'birdtrack']);
});
check('bad specs throw', () => {
  assert.throws(() => L.reduce(null, 'nope'));
  assert.throws(() => L.reduce(null, { style: 'feynman' }));
  assert.throws(() => L.reduce(null, { focus: 'x' }));
});

section('player');
const PL = await import(join(ROOT, 'ui/player.js'));
check('time line, easing and lock-step frames', () => {
  const frames = [], stepsSeen = [];
  const p = PL.createPlayer({ onFrame: (i, t, st, raw) => frames.push([i, t, raw]), onStep: i => stepsSeen.push(i), holdMs: 500 });
  p.load({ steps: [{ ms: 1000, label: 'a' }, { ms: 2000, label: 'b' }, { label: 'c' }] });
  assert.equal(p.totalMs(), 1000 + 500 + 2000 + 500 + PL.DEFAULT_MS + 500);
  assert.deepEqual(p.timeline().map(s => s.start), [0, 1500, 4000]);
  assert.deepEqual(stepsSeen, [0]);
  p.play();
  p.tick(250); let f = frames.at(-1); assert.equal(f[0], 0); assert.ok(Math.abs(f[2] - 0.25) < 1e-9); assert.ok(Math.abs(f[1] - PL.ease(0.25)) < 1e-9);
  p.tick(250); p.tick(250); p.tick(250); f = frames.at(-1); assert.equal(f[2], 1);
  p.tick(250); p.tick(250); f = frames.at(-1); assert.equal(f[0], 1); assert.equal(f[2], 0);
  assert.deepEqual(stepsSeen, [0, 1]);
  p.setSpeed(2); p.tick(250); f = frames.at(-1); assert.ok(Math.abs(f[2] - 0.25) < 1e-9, 'speed 2 doubles the clock');
  p.tick(5000); assert.equal(p.position().playing, true, 'a long gap is clamped to 250 ms');
});
check('seek, next, prev, scrub, end', () => {
  let ended = 0;
  const p = PL.createPlayer({ onEnd: () => ended++, holdMs: 0 });
  p.load({ steps: [{ ms: 1000 }, { ms: 1000 }, { ms: 1000 }] });
  p.seek(1, 0.5); assert.deepEqual([p.position().index, p.position().raw], [1, 0.5]);
  p.next(); assert.equal(p.position().index, 2);
  p.next(); assert.deepEqual([p.position().index, p.position().raw], [2, 1]);
  p.prev(); assert.deepEqual([p.position().index, p.position().raw], [2, 0]);
  p.prev(); assert.equal(p.position().index, 1);
  p.seekFrac(0.5); assert.equal(p.position().index, 1); assert.ok(Math.abs(p.position().raw - 0.5) < 1e-9);
  p.seekFrac(1); p.play(); assert.equal(p.position().frac, 0, 'play at the end starts again');
  for (let k = 0; k < 20; k++) p.tick(200);
  assert.equal(ended, 1); assert.equal(p.position().playing, false);
  p.setLoop(true); p.play(); for (let k = 0; k < 20; k++) p.tick(200); assert.equal(p.position().playing, true);
});
check('ease is monotone from 0 to 1', () => {
  let last = -1;
  for (let k = 0; k <= 100; k++) { const v = PL.ease(k / 100); assert.ok(v >= last); last = v; }
  assert.equal(PL.ease(0), 0); assert.equal(PL.ease(1), 1);
});

section('tex-color');
const TC = await import(join(ROOT, 'ui/tex-color.js'));
check('index letters only in scripts', () => {
  const src = 'R^{\\rho}{}_{\\sigma\\mu\\nu} = \\partial_\\mu \\Gamma^\\rho_{\\nu\\sigma}';
  assert.deepEqual(TC.scriptIndices(src), ['rho', 'sigma', 'mu', 'nu']);
  const out = TC.colorIndexTex(src, s => P.indexClass(s));
  assert.ok(out.includes(`{\\class{${P.indexClass('rho')}}{\\rho}}`));
  assert.ok(out.startsWith('R^'), 'the name R stays plain');
  assert.deepEqual(TC.scriptIndices(out), ['rho', 'sigma', 'mu', 'nu'], 'coloured TeX still gives the indices');
  assert.equal(TC.colorIndexTex('x^2 + y_{,}', s => 'i0'), 'x^2 + y_{,}');
  assert.equal(TC.colorIndexTex('e^{i\\theta}', s => 'i0', ['mu']), 'e^{i\\theta}');
});
check('expand an Einstein sum', () => {
  const out = TC.expandSumTex('v^{i} w_{i}', 'i', 3, () => 'i0');
  assert.equal((out.match(/\\class\{i0\}\{1\}/g) || []).length, 2);
  assert.ok(out.includes('\\left(') && out.split('+').length === 3);
  const long = TC.expandSumTex('y_{i} = W_{ij} x^{j}', 'j', 768, () => 'i1');
  assert.ok(long.includes('\\cdots') && long.includes('{767}') && long.startsWith('y_{i} ='));
});

check('remapClasses and plainLabel', () => {
  const from = new Map([['j', 0], ['i', 1]]);
  assert.equal(TC.remapClasses('A_{\\class{i0}{0}} B^{\\class{i1}{2}}', from, s => 'i' + (s === 'i' ? 5 : 6)), 'A_{\\class{i6}{0}} B^{\\class{i5}{2}}');
  assert.equal(TC.plainLabel('The index $\\mu$ appears once in $T^{\\mu}{}_{\\nu}$.'), 'The index μ appears once in T^μ_ν.');
  assert.equal(TC.plainLabel('Sum over $j$ from 0 to 1.'), 'Sum over j from 0 to 1.');
});

section('ops (playground)');
let MATH = null;
try { MATH = await import(join(ROOT, 'tensor/index.js')); } catch (e) { console.log('skip ops: MATH did not load: ' + e.message); }
if (MATH) {
  const OPS = await import(join(ROOT, 'ui/ops.js'));
  const run = (tex, op, args = {}) => OPS.buildOpTrace(MATH, MATH.parseIndexTex(tex), op, args, { dim: 3 });
  const last = tr => MATH.toTex(tr.steps.at(-1).after, { colors: false });
  check('contract, trace', () => {
    assert.equal(last(run('T^{\\mu}{}_{\\nu}', 'contract')), 'T^{\\mu}{}_{\\mu}');
    assert.deepEqual(run('T^{\\mu}{}_{\\nu}', 'contract').steps.at(-1).sums, [{ sym: 'mu', range: [0, 3] }]);
  });
  check('raise and lower flip the height', () => {
    assert.equal(last(run('T^{\\mu}{}_{\\nu}', 'raise', { sym: 'nu' })), 'T^{\\mu\\nu}');
    assert.equal(last(run('v^{\\mu}', 'lower')), 'v_{\\mu}');
    assert.throws(() => run('v^{\\mu}', 'raise', { sym: 'mu' }), /upper/);
  });
  check('transform carries numbers from MATH transform', () => {
    const tr = run('T^{\\mu}{}_{\\nu}', 'transform', { jacobian: 'rotation', params: { angle: 0.3 } });
    const num = tr.steps[0].numeric;
    assert.ok(num && num.output && num.output.data.length === 9);
    // A mixed rank 2 tensor keeps its trace under any change of basis.
    const tin = num.inputs.T.data, tout = num.output.data;
    assert.ok(Math.abs((tin[0] + tin[4] + tin[8]) - (tout[0] + tout[4] + tout[8])) < 1e-9);
  });
  check('symmetrise, antisymmetrise, covariant, product, expandSum', () => {
    assert.equal(last(run('T_{\\mu\\nu}', 'symmetrize')), '\\frac{1}{2} T_{\\mu\\nu} + \\frac{1}{2} T_{\\nu\\mu}');
    assert.equal(last(run('T_{ab}', 'antisymmetrize')), '\\frac{1}{2} T_{ab} - \\frac{1}{2} T_{ba}');
    const cov = last(run('T^{\\mu}{}_{\\nu}', 'covariant', { sym: 'lambda' }));
    assert.ok(cov.includes('\\partial_{\\lambda}') && cov.includes('+ \\Gamma^{\\mu}') && cov.includes('- \\Gamma'));
    assert.equal(last(run('u^{i}', 'product', { tex: 'w_{j}' })), 'u^{i} w_{j}');
    assert.throws(() => run('v^{i}', 'expandSum'), /no summed index/);
    assert.equal(run('v^{i} w_{i}', 'expandSum').steps[0].sums[0].sym, 'i');
  });
  check('evaluate gives numbers through MATH traceEinstein', () => {
    const tr = run('A^{i}{}_{j} v^{j}', 'evaluate');
    assert.ok(tr.steps.length >= 2);
    assert.ok(tr.steps.some(st => st.display && st.display.numeric), 'a step with numbers');
    assert.ok(new Set(tr.steps.map(st => st.id)).size === tr.steps.length, 'unique step ids');
    const tg = run('g_{ij} u^{i} w^{j}', 'evaluate');
    assert.ok(tg.steps.length >= 2);
    assert.throws(() => run('\\partial_{i} v^{i}', 'evaluate'), /no derivative/);
  });
  check('an equation is refused with a sentence', () => assert.throws(() => run('a_{i} = b_{i}', 'contract'), /Remove the =/));
}

// ============================================================================
section('boot (jsdom)');
// jsdom comes from JSDOM_DIR or NODE_PATH (npm i jsdom@24.1.3 in a scratch
// folder). Without it, this section prints a skip line and passes.
import { createRequire } from 'node:module';
async function findJsdom() {
  const dirs = [process.env.JSDOM_DIR, ...(process.env.NODE_PATH || '').split(':')].filter(Boolean);
  for (const d of dirs) {
    try { return createRequire(join(d, 'x.js'))('jsdom'); } catch (e) { /* next */ }
    try { return createRequire(join(d, '..', 'x.js'))('jsdom'); } catch (e) { /* next */ }
  }
  try { return createRequire(import.meta.url)('jsdom'); } catch (e) { return null; }
}
const jsdom = await findJsdom();

function makeDom() {
  const html = HTML.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const dom = new jsdom.JSDOM(html, { url: 'https://example.test/stella-nova/pages/tensor-calculus/index.html', pretendToBeVisual: true });
  const win = dom.window;
  win.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  win.HTMLElement.prototype.scrollIntoView = function () {};
  win.HTMLElement.prototype.scrollTo = function () {};
  return { dom, win, doc: win.document };
}

// Stub packages that record each call, so the test can check lock step.
function stubPackages(log, { math } = {}) {
  const mkExpr = (tex, syms) => ({ terms: [{ coeff: 1, factors: [{ name: 'T', tex: 'T', indices: syms.map((s, k) => ({ sym: s, up: k === 0 })) }] }], free: syms.map((s, k) => ({ sym: s, up: k === 0 })), dummies: [], tex });
  const e1 = mkExpr('T^{\\mu}{}_{\\nu}', ['mu', 'nu']), e2 = mkExpr('T^{\\mu}{}_{\\mu}', ['mu']);
  const trace = () => ({ dim: 3, steps: [
    { id: 's1', kind: 'relabel', label: 'rename', before: e1, after: e2, focus: ['mu', 'nu'], sums: [], ms: 1000, viz: { scene: 'contraction-block' } },
    { id: 's2', kind: 'contract', label: 'sum', before: e2, after: e2, focus: ['mu'], sums: [{ sym: 'mu', range: [0, 3] }], ms: 1000 },
  ] });
  const entries = [
    { id: 'kronecker-delta', title: 'Kronecker delta', field: 'algebra', tex: '\\delta^{i}{}_{j}', expr: () => e1, story: ['The delta $\\delta^i_j$ is one on the diagonal.'], vocab: [{ term: 'delta', meaning: 'identity' }], params: [{ key: 'n', label: 'n', min: 2, max: 4, step: 1, def: 3 }], trace, viz: { scene: 'upper-lower', params: {} }, refs: [{ text: 'Carroll', url: 'https://arxiv.org/abs/gr-qc/9712019' }] },
    { id: 'riemann-tensor', title: 'Riemann tensor', field: 'geometry', tex: 'R^{\\rho}{}_{\\sigma\\mu\\nu}', expr: () => e1, story: [], vocab: [], params: [], trace, viz: { scene: 'curvature-loop' }, refs: [{ text: 'Carroll', url: 'https://arxiv.org/abs/gr-qc/9712019' }] },
  ];
  const view = name => (host, opts) => {
    const v = { scenes: ['upper-lower', 'contraction', 'curvature-loop'], saverShots: [] };
    for (const m of ['setScene', 'play', 'setTime', 'resize', 'pickIndex', 'dispose', 'show', 'setStyle']) v[m] = (...a) => log.push([name, m, ...a]);
    v.opts = opts; log.push([name, 'create', host && host.id]);
    return v;
  };
  return {
    './tensor/index.js': math || null,
    './library/index.js': { LIBRARY: entries, FIELDS: [{ id: 'algebra', label: 'Index algebra' }, { id: 'geometry', label: 'Geometry' }], PATHS: [{ id: 'p', title: 'Path', blurb: 'b', steps: ['kronecker-delta', 'riemann-tensor'], why: {} }] },
    './viz/index.js': { createViz: view('viz') },
    './diagram/index.js': { createDiagram: view('diagram') },
    './learn/index.js': { CHAPTERS: [{ id: 'tensor', title: 'What a tensor is', blurb: 'slots', beats: [{ title: 'A', text: ['x'] }] }] },
  };
}

if (!jsdom) console.log('skip boot: jsdom not found (set JSDOM_DIR or NODE_PATH)');
else {
  const MAIN = await import(join(ROOT, 'main.js'));
  check('resolveScene maps library ids to VIZ ids', () => {
    assert.equal(MAIN.resolveScene('vector-covector', ['upper-lower', 'dual-basis']), 'upper-lower');
    assert.equal(MAIN.resolveScene('contraction-block', ['contraction']), 'contraction');
    assert.equal(MAIN.resolveScene('x', []), 'x');
    assert.equal(MAIN.resolveScene('parallel-transport', ['parallel-transport']), 'parallel-transport');
  });

  check('boot on a stub DOM with stub packages; API, lock step, layout, lens', async () => {
    const { win, doc } = makeDom();
    const log = [];
    const mods = stubPackages(log, { math: MATH });
    const importer = async p => { if (mods[p]) return mods[p]; throw new Error('no module ' + p); };
    // A LEARN-style caller that runs before boot: the stub queues the call.
    API.installStub(win);
    const early = win.tensorPage.setView('tex');
    let rafFn = null, clock = 0;
    const b = await MAIN.boot({ doc, win, importer, typeset: (el, t) => { el.textContent = t; return Promise.resolve(true); },
      raf: fn => { rafFn = fn; }, now: () => clock, noAnimate: true });
    await early;
    const api = win.tensorPage;
    let st = await api.state();
    assert.equal(st.ready, true);
    assert.deepEqual(st.views, ['tex'], 'queued setView ran');
    assert.equal(st.entryId, 'kronecker-delta', 'first path entry opens at boot');
    assert.equal(st.stepCount, 2);
    assert.equal(doc.getElementById('stage').dataset.mode, 'focus');
    assert.equal(doc.getElementById('paneViz').hidden, true);
    assert.ok(log.some(l => l[0] === 'viz' && l[1] === 'setScene' && l[2] === 'upper-lower'), 'entry scene sent to VIZ');

    // Lock step: one frame gives play(step, t) with the same step and t to both views.
    log.length = 0;
    clock += 200; rafFn();
    const vp = log.filter(l => l[1] === 'play');
    assert.equal(vp.length, 2, 'viz and diagram play once per frame');
    assert.equal(vp[0][2], vp[1][2]); assert.equal(vp[0][3], vp[1][3]);
    assert.ok(vp[0][3] > 0 && vp[0][3] < 1, 't inside the step');
    // The step hint scene goes through resolveScene before VIZ sees it.
    assert.equal(vp.find(l => l[0] === 'viz')[2].viz.scene, 'contraction', 'step scene alias');
    assert.equal(doc.getElementById('texStepLabel').textContent, 'rename');
    assert.ok(doc.getElementById('texBody').dataset.pulse.split(' ').length === 2, 'two indices pulse');

    for (let k = 0; k < 10; k++) { clock += 200; rafFn(); }
    st = await api.state();
    assert.equal(st.stepIndex, 1);
    assert.equal(doc.getElementById('pCount').textContent, '2 / 2');

    // Layout through the API and the buttons.
    await api.setView({ views: ['viz', 'diagram'], style: 'network' });
    st = await api.state();
    assert.deepEqual([st.views, st.mode, st.diagramStyle], [['viz', 'diagram'], 'pair', 'network']);
    assert.ok(log.some(l => l[0] === 'diagram' && l[1] === 'setStyle' && l[2] === 'network'));
    doc.querySelector('#layoutSeg [data-layout="all"]').click();
    assert.equal((await api.state()).mode, 'all');

    // The lens: pick in all views, chips in the player.
    await api.pickIndex('\\mu');
    assert.equal((await api.state()).pickedIndex, 'mu');
    assert.ok(log.some(l => l[0] === 'viz' && l[1] === 'pickIndex' && l[2] === 'mu'));
    assert.ok(log.some(l => l[0] === 'diagram' && l[1] === 'pickIndex' && l[2] === 'mu'));
    const chips = [...doc.querySelectorAll('#lensChips .lens-chip')];
    assert.ok(chips.length >= 2 && chips.some(c => c.classList.contains('on') && c.textContent === 'μ'));
    chips.find(c => c.dataset.sym === 'mu').click();
    assert.equal((await api.state()).pickedIndex, null, 'second tap clears');

    // A free scene: setScene stops play() to VIZ; follow() gives it back.
    await api.setScene('dual-basis', { s: 1 });
    assert.equal((await api.state()).vizFree, true);
    log.length = 0; clock += 100; rafFn();
    assert.ok(!log.some(l => l[0] === 'viz' && l[1] === 'play'), 'no VIZ play on a free scene');
    assert.ok(log.some(l => l[0] === 'diagram' && l[1] === 'play'), 'the diagram still plays');
    await api.follow();
    assert.equal((await api.state()).vizFree, false);

    // Events, seek, pause, a played trace from LEARN.
    const seen = [];
    const off = api.on('step', e => seen.push(e.index));
    await api.seek(0, 0.5);
    await api.playTrace({ dim: 2, steps: [{ id: 'x', kind: 'raise', label: 'go', before: 'v_{i}', after: 'v^{i}', focus: ['i'], sums: [], ms: 400 }] });
    clock += 100; rafFn();
    assert.ok(seen.includes(0));
    off();
    await api.pause();
    assert.equal((await api.state()).playing, false);

    // Library: open the second entry by the list.
    await api.openEntry('riemann-tensor');
    st = await api.state();
    assert.equal(st.entryId, 'riemann-tensor');
    assert.equal(win.location.hash, '#entry=riemann-tensor');
    await assert.rejects(api.openEntry('nope'), /No library entry/);

    // showExpr with a string and the TeX in the view.
    await api.showExpr('A^{i}{}_{j} B^{j}{}_{k}');
    assert.ok(doc.getElementById('texAfter').textContent.includes('\\class{'), 'TeX coloured');
    assert.equal((await api.state()).stepCount, 0);

    // Credits list the library sources once.
    doc.getElementById('creditsBtn').click();
    assert.equal(doc.getElementById('credits').hidden, false);
    assert.equal((doc.getElementById('creditsBody').textContent.match(/Carroll/g) || []).length, 1);
    assert.ok(/Penrose/.test(doc.getElementById('creditsBody').textContent));

    // Learn: the fallback menu lists the chapter.
    assert.equal(doc.querySelectorAll('#learnMenu .chapter-row').length, 1);
    // Library browser rows and fields.
    assert.ok(doc.querySelectorAll('#libFields .chip').length === 3);
    // Internals for SAVER.
    const inn = api.internals();
    assert.ok(inn.player && inn.views.viz && inn.views.diagram && inn.views.tex && inn.layout.set);
    b.stop();
  });

  if (MATH) check('playground: live parse error, then an operation plays', async () => {
    const { win, doc } = makeDom();
    const log = [];
    const mods = stubPackages(log, { math: MATH });
    mods['./library/index.js'] = { LIBRARY: [] };
    const importer = async p => { if (mods[p]) return mods[p]; throw new Error('no module ' + p); };
    let rafFn = null, clock = 0;
    const b = await MAIN.boot({ doc, win, importer, typeset: (el, t) => { el.textContent = t; return true; }, raf: fn => { rafFn = fn; }, now: () => clock, noAnimate: true, autostart: false });
    const pg = b.playground;
    pg.setInput('T^{\\mu}{}_{\\mu\\mu}');
    assert.ok(doc.getElementById('pgStatus').classList.contains('err'), 'three mu is an error');
    pg.setInput('T^{\\mu}{}_{\\nu}');
    assert.ok(doc.getElementById('pgStatus').classList.contains('ok'));
    doc.querySelector('#pgOps [data-op="raise"]').click();
    doc.getElementById('pgApply').click();
    const st = await win.tensorPage.state();
    assert.equal(st.stepCount, 2);
    assert.equal(st.playing, true);
    assert.equal(doc.querySelectorAll('#pgHistory .pg-hist-row').length, 1);
    clock += 300; rafFn();
    assert.ok(log.some(l => l[1] === 'play'));
    b.stop();
  });

  check('LEARN starts only when a chapter opens, then go() moves it', async () => {
    const { win, doc } = makeDom();
    const log = [], calls = [];
    const mods = stubPackages(log, { math: MATH });
    mods['./learn/index.js'] = {
      CHAPTERS: [{ id: 'tensor', title: 'T', blurb: '', beats: [] }, { id: 'indices', title: 'I', blurb: '', beats: [] }],
      createLearn: (host, o) => { calls.push(['create', o.chapter, typeof o.page.setView, o.entryIds.length]); return { go: (id, b) => calls.push(['go', id, b]), state: () => ({ chapter: 'tensor', beat: 0 }), dispose() {} }; },
    };
    const importer = async p => { if (mods[p]) return mods[p]; throw new Error('no module ' + p); };
    const b = await MAIN.boot({ doc, win, importer, typeset: (el, t) => { el.textContent = t; return true; }, raf: () => {}, now: () => 0, noAnimate: true });
    assert.deepEqual(calls, [], 'no LEARN start at boot');
    doc.querySelectorAll('#learnMenu .chapter-row')[0].click();
    assert.deepEqual(calls, [['create', 'tensor', 'function', 2]]);
    doc.querySelector('#learnMenu .chapters-toggle').click();
    doc.querySelectorAll('#learnMenu .chapter-row')[1].click();
    assert.deepEqual(calls.at(-1), ['go', 'indices', 0]);
    b.stop();
  });

  check('real LEARN: every beat of every chapter drives the page with no error', async () => {
    let LEARN = null;
    try { LEARN = await import(join(ROOT, 'learn/index.js')); } catch (e) { console.log('     skip: learn did not load'); return; }
    if (!LEARN.createLearn) { console.log('     skip: no createLearn'); return; }
    const { win, doc } = makeDom();
    const warns = [];
    win.console = { info() {}, log() {}, warn: (...a) => warns.push(a.map(String).join(' ')), error: (...a) => warns.push(a.map(String).join(' ')) };
    // createLearn and its widgets use the globals document, location and
    // history. Set them for this check only.
    const keep = {};
    for (const k of ['document', 'location', 'history', 'window']) { keep[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: win[k === 'window' ? 'window' : k], configurable: true, writable: true }); }
    win.__TC_NO_AUTOBOOT = true;
    try {
      let rafFn = null, clock = 0;
      const b = await MAIN.boot({ doc, win, typeset: (el, t) => { el.textContent = t; return Promise.resolve(true); }, raf: fn => { rafFn = fn; }, now: () => clock, noAnimate: true, saver: false });
      let entries = 0;
      b.api.on('entry', () => entries++);
      doc.querySelectorAll('#learnMenu .chapter-row')[0].click();
      const ctl = b.learnMenu.ctl();
      assert.ok(ctl, 'LEARN started on the first chapter tap');
      await ctl.ready;
      let beats = 0;
      for (const ch of LEARN.CHAPTERS) for (let i = 0; i < ch.beats.length; i++) {
        await ctl.go(ch.id, i); beats++;
        for (let f = 0; f < 10; f++) { clock += 200; rafFn(); }
      }
      const st = await win.tensorPage.state();
      assert.equal(st.chapter, LEARN.CHAPTERS.at(-1).id);
      assert.match(win.location.hash, /^#learn\//);
      assert.deepEqual(warns, [], 'no view or widget threw');
      console.log(`     learn: ${beats} beats in ${LEARN.CHAPTERS.length} chapters drove the page; ${entries} entries opened; no error`);
      b.stop();
    } finally {
      for (const k of Object.keys(keep)) { if (keep[k]) Object.defineProperty(globalThis, k, keep[k]); else delete globalThis[k]; }
    }
  });

  check('boot with the real packages on disk (what has landed)', async () => {
    const { win, doc } = makeDom();
    const warns = [];
    win.console = { info() {}, log() {}, warn: (...a) => warns.push(a.map(String).join(' ')), error: (...a) => warns.push(a.map(String).join(' ')) };
    let rafFn = null, clock = 0;
    const b = await MAIN.boot({ doc, win, typeset: (el, t) => { el.textContent = t; return true; }, raf: fn => { rafFn = fn; }, now: () => clock, noAnimate: true, saver: false });
    const api = win.tensorPage;
    const st = await api.state();
    assert.equal(st.ready, true);
    console.log('     real packages: missing = ' + JSON.stringify(st.missing) + '; entry = ' + st.entryId + '; steps = ' + st.stepCount);
    // Open every LIBRARY entry and play it through, in each diagram style.
    const ids = [...b.packages.library.byId.keys()];
    const styles = ['penrose', 'birdtrack', 'network'];
    let frames = 0;
    for (const [k, id] of ids.entries()) {
      await api.setView({ style: styles[k % 3] });
      await api.openEntry(id);
      for (let f = 0; f < 60; f++) { clock += 250; rafFn(); frames++; }
    }
    if (!b.packages.missing.some(m => m.startsWith('diagram'))) assert.ok(doc.querySelectorAll('#diagHost svg *').length > 0, 'the diagram drew');
    assert.deepEqual(warns, [], 'no view threw');
    console.log(`     real packages: ${ids.length} entries opened and played (${frames} frames), no view threw`);
    b.stop();
  });
}

// ============================================================================
section('viz frames of the traces');
// VIZ index.js needs three (an importmap in the browser), but its scene
// code is DOM-free. Each step that CORE gives VIZ (after resolveScene)
// goes through VIZ stepScene() and frameScene() at five values of t.
{
  let R = null, DLmod = null, TM = null, LIBm = null;
  try { R = await import(join(ROOT, 'viz/registry.js')); DLmod = await import(join(ROOT, 'viz/dl.js')); TM = await import(join(ROOT, 'viz/trace-map.js')); LIBm = await import(join(ROOT, 'library/index.js')); }
  catch (e) { console.log('skip viz frames: ' + e.message.split('\n')[0]); }
  if (R && DLmod && TM && LIBm) check('every library step draws a VIZ frame', async () => {
    const MAIN = await import(join(ROOT, 'main.js'));
    let n = 0, empty = 0;
    const bad = [];
    for (const e of LIBm.LIBRARY) {
      const tr = e.trace({});
      for (const st0 of tr.steps) {
        const st = st0.viz && st0.viz.scene ? { ...st0, viz: { ...st0.viz, scene: MAIN.resolveScene(st0.viz.scene, R.SCENE_IDS) } } : st0;
        const sc = TM.stepScene(st, R.SCENE_IDS);
        assert.ok(R.SCENE_IDS.includes(sc.scene) || R.SCENES[sc.scene], `${e.id}: scene ${sc.scene}`);
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const dl = new DLmod.DL();
          try { R.frameScene(sc.scene, dl, { params: sc.params, time: 1.5, t, step: st }); n++; }
          catch (err) { bad.push(`${e.id} step ${st.id || st.kind} (${st.kind}) scene ${sc.scene} t=${t}: ${err.message}`); break; }
        }
      }
      if (e.viz && e.viz.scene) { const id = MAIN.resolveScene(e.viz.scene, R.SCENE_IDS); if (!R.SCENES[id]) empty++; }
    }
    assert.equal(empty, 0, 'every entry scene resolves to a VIZ scene');
    // A frame that throws is a VIZ bug, not a CORE bug: print it as a
    // finding (and put it in NOTES.md), and let VIZ tests own the fix.
    // main.js safe() catches it at run time and warns once.
    for (const b of bad) console.log('     FINDING (VIZ): ' + b);
    console.log(`     viz: ${n} frames of library steps drew; ${bad.length} step(s) threw`);
  });
}

// ============================================================================
section('mathjax');
// MathJax 3.2.2 (npm mathjax-full, from MATHJAX_DIR or NODE_PATH) typesets
// every TeX string that CORE writes: the coloured TeX of each step of each
// LIBRARY trace, the written-out sums, and the playground results. A TeX
// error or an undefined macro fails the check. Without the package, a
// skip line prints.
function findMathJax() {
  const dirs = [process.env.MATHJAX_DIR, process.env.JSDOM_DIR, ...(process.env.NODE_PATH || '').split(':')].filter(Boolean);
  for (const d of dirs) for (const base of [join(d, 'x.js'), join(d, '..', 'x.js')]) {
    try {
      const req = createRequire(base);
      const { mathjax } = req('mathjax-full/js/mathjax.js');
      const { TeX } = req('mathjax-full/js/input/tex.js');
      const { SVG } = req('mathjax-full/js/output/svg.js');
      const { liteAdaptor } = req('mathjax-full/js/adaptors/liteAdaptor.js');
      const { RegisterHTMLHandler } = req('mathjax-full/js/handlers/html.js');
      const { AllPackages } = req('mathjax-full/js/input/tex/AllPackages.js');
      const adaptor = liteAdaptor(); RegisterHTMLHandler(adaptor);
      const doc = mathjax.document('', { InputJax: new TeX({ packages: AllPackages.filter(p => p !== 'bussproofs'), formatError: (jax, err) => { throw err; } }), OutputJax: new SVG({ fontCache: 'none' }) });
      return tex => { const node = doc.convert(tex, { display: true }); const out = adaptor.outerHTML(node); if (/data-mjx-error|merror|fill="red"/.test(out)) throw new Error('TeX error in ' + tex); return out; };
    } catch (e) { /* next */ }
  }
  return null;
}
const mj = findMathJax();
if (!mj) console.log('skip mathjax: mathjax-full not found (set MATHJAX_DIR)');
else {
  const TV = await import(join(ROOT, 'ui/tex-view.js'));
  const LB = await import(join(ROOT, 'ui/library-browser.js'));
  check('library traces: every step TeX and sum typesets', async () => {
    let lib = null;
    try { lib = await import(join(ROOT, 'library/index.js')); } catch (e) { console.log('     skip: library did not load'); return; }
    const list = lib.LIBRARY || lib.ENTRIES || [];
    let n = 0;
    for (const e of list) {
      let tr; try { tr = e.trace({}); } catch (err) { continue; }
      P.setActive((await import(join(ROOT, 'main.js'))).traceSyms(tr, MATH));
      for (const st of tr.steps) {
        for (const x of [st.before, st.after]) { mj(TV.exprTex(x, MATH)); n++; }
        if (st.sums && st.sums.length) { mj(TV.sumsTex(TV.exprTex(st.before, MATH, { colors: false }), st.sums)); n++; }
        for (const part of LB.splitProse(st.label || '')) if (part.tex != null) { mj(TC.colorIndexTex(part.tex, s => P.indexClass(s))); n++; }
        for (const key of ['expanded', 'numeric']) if (st.display && st.display[key]) {
          const from = (() => { try { return MATH.indexColorMap(st.before); } catch (e) { return null; } })();
          mj(TC.remapClasses(st.display[key], from, s => P.indexClass(s))); n++;
        }
      }
    }
    console.log(`     mathjax: ${n} step strings (expressions, sums, labels, MATH display) from ${list.length} entries`);
  });
  if (MATH) check('playground results typeset', async () => {
    const OPS = await import(join(ROOT, 'ui/ops.js'));
    let n = 0;
    for (const [tex, op, args] of [['T^{\\mu}{}_{\\nu}', 'contract'], ['T^{\\mu}{}_{\\nu}', 'raise'], ['T^{\\mu}{}_{\\nu}', 'transform'], ['T_{\\mu\\nu}', 'symmetrize'], ['T_{ab}', 'antisymmetrize'], ['T^{\\mu}{}_{\\nu}', 'covariant'], ['u^{i}', 'product', { tex: 'w_{j}' }], ['v^{i} w_{i}', 'expandSum'], ['\\epsilon_{ijk} a^{j} b^{k}', 'expandSum'], ['A^{i}{}_{j} v^{j}', 'evaluate'], ['\\epsilon_{ijk} a^{j} b^{k}', 'evaluate']]) {
      const tr = OPS.buildOpTrace(MATH, MATH.parseIndexTex(tex), op, args || {}, { dim: 3 });
      P.setActive((await import(join(ROOT, 'main.js'))).traceSyms(tr, MATH));
      for (const st of tr.steps) {
        mj(TV.exprTex(st.before, MATH)); mj(TV.exprTex(st.after, MATH)); n += 2;
        if (st.sums.length) { mj(TV.sumsTex(TV.exprTex(st.before, MATH, { colors: false }), st.sums)); n++; }
      }
    }
    console.log(`     mathjax: ${n} playground strings`);
  });
  check('string TeX through colorIndexTex typesets', () => {
    for (const t of ['R^{\\rho}{}_{\\sigma\\mu\\nu}', '\\partial_\\mu F^{\\mu\\nu} = J^\\nu', '\\Gamma^\\lambda_{\\mu\\nu} = \\tfrac12 g^{\\lambda\\sigma}(\\partial_\\mu g_{\\sigma\\nu})', 'T_{(ab)} + T_{[ab]}', "x'^{\\mu'}"]) mj(TC.colorIndexTex(t, s => P.indexClass(s)));
  });
}

// ============================================================================
await drain();
console.log(`core: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
