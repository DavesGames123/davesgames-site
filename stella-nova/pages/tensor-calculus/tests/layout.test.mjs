// ============================================================================
//  TENSOR CALCULUS  ·  tests/layout.test.mjs  ·  pane, player and phone sizes
// ----------------------------------------------------------------------------
//  node stella-nova/pages/tensor-calculus/tests/layout.test.mjs
//  1. ui/fit-layout.js with no DOM: SIZES match style.css; the device of
//     each viewport; each pane header fits on one line and the player fits,
//     at 1024, 1280 and 1440 wide (tall and short) and on the phone sizes
//     360x740, 390x844, 430x932, 768x1024 and 844x390; texScale.
//  2. style.css: the phone rules (44 px targets, safe-area insets, one view
//     at a time, TeX that scrolls in its own box, the player grid).
//  3. jsdom (JSDOM_DIR or NODE_PATH): main.js boots at each viewport with a
//     matchMedia for that size; the data attributes, the phone switch and
//     player, and a 3D tap that picks an index in all views.
//  No browser runs here. Real pixel sizes are not checked.
// ============================================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const queue = [];
const check = (name, fn) => queue.push([name, fn]);

const F = await import(join(ROOT, 'ui/fit-layout.js'));
const CSS = read('style.css'), HTML = read('index.html');
const flat = CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');

const DESKTOP = [[1024, 768], [1024, 1366], [1024, 600], [1280, 800], [1280, 1400], [1280, 600], [1440, 900], [1440, 1600], [1440, 560]];
const PHONES = [[360, 740], [390, 844], [430, 932], [768, 1024], [844, 390]];
const LV = ['l', 'm', 's', 'xs'];

// ---- 1. DOM-free ---------------------------------------------------------------
check('SIZES match style.css', () => {
  const S = F.SIZES;
  assert.ok(flat.includes(`--top-h:${S.topH}px`), 'top-h');
  assert.ok(flat.includes(`--player-h:${S.playerH}px`), 'player-h');
  assert.ok(flat.includes(`--gap:${S.gap}px`), 'gap');
  assert.ok(flat.includes(`--panel-w:min(${S.panelW}px,${Math.round(S.panelVw * 100)}vw)`), 'panel-w');
  assert.ok(flat.includes(`html.in-frame{--top-h:${S.topHFrame}px}`), 'in-frame top');
  assert.ok(flat.includes(`--dock-h:calc(${S.dockH}px+env(safe-area-inset-bottom))`), 'dock-h');
  assert.ok(flat.includes(`--top-h:calc(${S.phoneTopH}px+env(safe-area-inset-top));--player-h:${S.phonePlayerH}px`), 'phone top and player');
  assert.ok(flat.includes(`--land-h:calc(${S.landBarH}px+env(safe-area-inset-bottom));--dock-w:calc(${S.landDockW}px+env(safe-area-inset-right))`), 'landscape bar');
});
check('deviceOf at each viewport', () => {
  for (const [w, h] of DESKTOP) assert.equal(F.deviceOf({ w, h }), 'desktop', `${w}x${h}`);
  assert.deepEqual(PHONES.map(([w, h]) => F.deviceOf({ w, h, coarse: true })), ['portrait', 'portrait', 'portrait', 'portrait', 'landscape']);
  assert.equal(F.deviceOf({ w: 1280, h: 480 }), 'desktop', 'a short desktop window is not a phone');
  assert.equal(F.deviceOf({ w: 1024, h: 768, coarse: true }), 'desktop', 'a tablet in landscape keeps the desktop grid');
});
check('header levels: each level needs less room, and the phone has no focus or close', () => {
  for (const p of ['tex', 'viz', 'diagram']) {
    const ws = LV.map(l => F.headWidth(p, l));
    for (let k = 1; k < ws.length; k++) assert.ok(ws[k] <= ws[k - 1], `${p} ${LV[k]}`);
    assert.ok(F.headWidth(p, 'l', { phone: true }) < F.headWidth(p, 'l'), `${p} phone`);
  }
  assert.throws(() => F.headWidth('x', 'l')); assert.throws(() => F.headWidth('tex', 'q'));
});
let rows = [];
check('desktop: every pane header and the player fit, in all, pair and focus, panel open and closed', () => {
  for (const [w, h] of DESKTOP) for (const panelOpen of [true, false]) for (const views of [['tex', 'viz', 'diagram'], ['viz', 'diagram'], ['tex', 'viz'], ['diagram'], ['tex']]) {
    const p = F.planLayout({ w, h }, { panelOpen, views });
    assert.equal(p.device, 'desktop');
    const a = p.stage.w / p.stage.h;
    if (views.length === 3) assert.equal(p.shape, a >= 1.25 && (p.stage.w - 30) / 2.3 >= F.WIDE_MIN ? 'wide' : a >= 0.7 ? 'tall' : 'column', `${w}x${h} shape`);
    for (const v of views) {
      const b = p.panes[v];
      assert.ok(b.w > 150 && b.h > 120, `${w}x${h} ${views} ${v}: box ${b.w}x${b.h}`);
      assert.ok(F.headWidth(v, b.head) <= b.w, `${w}x${h} ${v}: head ${b.head} needs ${F.headWidth(v, b.head)} > ${b.w}`);
    }
    assert.ok(F.playerWidth(p.player, p.playerW) <= p.playerW, `${w}x${h}: player ${p.player}`);
    if (views.length === 3 && !panelOpen) rows.push(`${w}x${h} ${p.shape} player ${p.player} heads ${views.map(v => p.panes[v].head).join('')}`);
  }
  // the panel open at 1024 still keeps the step label 110 px or more
  const p = F.planLayout({ w: 1024, h: 768 }, { panelOpen: true });
  assert.ok(p.playerW - (F.playerWidth(p.player, p.playerW) - 110) >= 110);
});
check('desktop: a tall window does not give a tall empty 3D column', () => {
  for (const [w, h] of [[1024, 1366], [1280, 1400], [1440, 1600]]) {
    const p = F.planLayout({ w, h }, { panelOpen: true });
    assert.notEqual(p.shape, 'wide', `${w}x${h}`);
    const v = p.panes.viz;
    assert.ok(v.w / v.h > 0.9, `${w}x${h}: 3D pane ${v.w.toFixed(0)}x${v.h.toFixed(0)}`);
  }
});
check('phones: one view at a time, headers fit at 44 px targets', () => {
  for (const [w, h] of PHONES) {
    const p = F.planLayout({ w, h, coarse: true }, { views: ['tex'] });
    assert.deepEqual(p.views, ['tex', 'viz', 'diagram'], `${w}x${h} keeps all three in the row`);
    assert.equal(p.shape, 'one');
    for (const v of p.views) {
      assert.equal(p.panes[v].w, w);
      assert.ok(F.headWidth(v, p.panes[v].head, { phone: true }) <= w, `${w}x${h} ${v} head`);
    }
    assert.equal(p.player, w > h ? 'land' : 'phone');
    assert.ok(p.stage.h >= (w > h ? 300 : 500), `${w}x${h}: stage ${p.stage.h} tall`);
  }
});
check('texScale grows, clamps, and flags a line that must scroll', () => {
  let r = F.texScale({ contentW: 200, contentH: 50, boxW: 600, boxH: 400 });
  assert.equal(r.k, 2.2); assert.equal(r.scroll, false);
  r = F.texScale({ contentW: 300, contentH: 60, boxW: 450, boxH: 400 });
  assert.equal(r.k, 1.5);
  r = F.texScale({ contentW: 600, contentH: 60, boxW: 600, boxH: 400, k: 2 });
  assert.equal(r.k, 2, 'the measure at k = 2 is the natural size times 2');
  r = F.texScale({ contentW: 900, contentH: 60, boxW: 330, boxH: 400, min: 0.7 });
  assert.equal(r.k, 0.7); assert.equal(r.scroll, true);
  r = F.texScale({ contentW: 0, contentH: 0, boxW: 300, boxH: 300, k: 1.3 });
  assert.deepEqual(r, { k: 1.3, scroll: false });
});

// ---- 2. CSS --------------------------------------------------------------------------
const phoneBlock = (() => { const a = CSS.indexOf('/* PHONE.'), b = CSS.indexOf('/* sn-saver.'); return CSS.slice(a, b).replace(/\s+/g, ''); })();
check('style.css: the player is a grid with an ellipsised label', () => {
  assert.ok(flat.includes('grid-template-areas:"prevplaynextlabelspeedsteplens""prevplaynextscrubspeedsteplens"'), 'desktop areas');
  assert.ok(/#player\{[^}]*display:grid/.test(flat), 'grid');
  assert.ok(/minmax\(0,1fr\)autoautofit-content\(28%\)/.test(flat), 'label column minmax(0,1fr)');
  assert.ok(/#pLabel\{[^}]*text-overflow:ellipsis[^}]*min-width:0/.test(flat), 'ellipsis');
  assert.ok(!/class="pl-(buttons|track|top)"/.test(HTML), 'no flex wrappers left');
});
check('style.css: pane headers never wrap', () => {
  assert.ok(/\.pane-head\{[^}]*white-space:nowrap;overflow:hidden/.test(flat));
  for (const lv of ['m', 's', 'xs']) assert.ok(flat.includes(`[data-head="${lv}"]`), lv);
});
check('style.css phone: 44 px targets, safe areas, one view, TeX scroll box', () => {
  for (const s of ['.mini,.seg.smallbutton{min-height:44px', '.lens-chip{min-width:44px;height:44px}', '.chip{min-height:44px}', '.step-listbutton{min-height:44px',
    '#pPrev,#pNext{width:48px;height:48px', '#pPlay{width:56px;height:48px', '.pane-focus,.pane-close{display:none}', '#dock>button{flex:0048px;height:48px',
    'scroll-snap-type:xmandatory', '#stage.pane{flex:00100%', 'grid-template-areas:"prevplaynextlabel""scrubscrubscrubstep"',
    'env(safe-area-inset-left)', 'env(safe-area-inset-right)', 'env(safe-area-inset-bottom)', 'env(safe-area-inset-top)', '.viz-body{touch-action:none}'])
    assert.ok(phoneBlock.includes(s), 'missing ' + s);
  assert.ok(/\.tex-line\{[^}]*overflow-x:auto/.test(flat), 'TeX lines scroll in their own box');
  assert.ok(flat.includes('html{background:var(--bg);overflow-x:hidden}'), 'no page scroll');
  assert.ok(flat.includes('@media(max-height:500px)and(orientation:landscape)and(pointer:coarse),(max-width:768px)and(max-height:500px)and(orientation:landscape)'), 'landscape query');
});
check('index.html: the phone switch is Equation / 3D / Penrose, the player has Pause each step', () => {
  const dock = HTML.slice(HTML.indexOf('<nav id="dock"'), HTML.indexOf('</nav>', HTML.indexOf('<nav id="dock"')));
  assert.deepEqual([...dock.matchAll(/data-layout="(\w+)"[^>]*>([^<]+)</g)].map(m => [m[1], m[2]]), [['tex', 'Equation'], ['viz', '3D'], ['diagram', 'Penrose']]);
  assert.ok(/id="pStepPause" checked><span>Pause each step<\/span>/.test(HTML));
});

// ---- 3. jsdom at each viewport --------------------------------------------------------
async function findJsdom() {
  const dirs = [process.env.JSDOM_DIR, ...(process.env.NODE_PATH || '').split(':')].filter(Boolean);
  for (const d of dirs) {
    try { return createRequire(join(d, 'x.js'))('jsdom'); } catch (e) { /* next */ }
    try { return createRequire(join(d, '..', 'x.js'))('jsdom'); } catch (e) { /* next */ }
  }
  try { return createRequire(import.meta.url)('jsdom'); } catch (e) { return null; }
}
const jsdom = await findJsdom();

// A media query for a viewport: a list of (feature:value) groups with "and".
function mediaMatch(q, { w, h, coarse }) {
  return q.split(',').some(part => [...part.matchAll(/\(\s*([a-z-]+)\s*:\s*([a-z0-9.]+)\s*\)/g)].every(([, f, v]) => {
    if (f === 'max-width') return w <= parseFloat(v);
    if (f === 'min-width') return w >= parseFloat(v);
    if (f === 'max-height') return h <= parseFloat(v);
    if (f === 'pointer') return (v === 'coarse') === !!coarse;
    if (f === 'orientation') return (v === 'landscape') === (w > h);
    if (f === 'prefers-reduced-motion') return false;
    return false;
  }));
}

function stubs(log) {
  const e1 = { terms: [{ coeff: 1, factors: [{ name: 'T', tex: 'T', indices: [{ sym: 'mu', up: true }, { sym: 'nu', up: false }] }] }], free: [{ sym: 'mu', up: true }, { sym: 'nu', up: false }], dummies: [], tex: 'T^{\\mu}{}_{\\nu}' };
  const trace = () => ({ dim: 3, steps: [
    { id: 's1', kind: 'contract', label: 'Set nu = mu and sum over the repeated index', before: e1, after: e1, focus: ['mu', 'nu'], sums: [], ms: 1000, viz: { scene: 'contraction' } },
    { id: 's2', kind: 'relabel', label: 'rename', before: e1, after: e1, focus: ['mu'], sums: [], ms: 1000 },
  ] });
  const entries = [{ id: 'kronecker-delta', title: 'Kronecker delta', field: 'algebra', tex: '\\delta^{i}{}_{j}', expr: () => e1, story: ['x'], vocab: [], params: [], trace, viz: { scene: 'contraction' }, refs: [] }];
  const view = name => (host, opts) => {
    const v = { scenes: ['contraction', 'upper-lower'], saverShots: [], opts };
    for (const m of ['setScene', 'play', 'setTime', 'resize', 'pickIndex', 'dispose', 'show', 'setStyle']) v[m] = (...a) => log.push([name, m, ...a]);
    log.push([name, 'create']);
    views[name] = v;
    return v;
  };
  const views = {};
  return { views, mods: {
    './library/index.js': { LIBRARY: entries, FIELDS: [{ id: 'algebra', label: 'Index algebra' }], PATHS: [{ id: 'p', title: 'Path', blurb: 'b', steps: ['kronecker-delta'], why: {} }] },
    './viz/index.js': { createViz: view('viz') },
    './diagram/index.js': { createDiagram: view('diagram') },
  } };
}

async function bootAt(vp) {
  const html = HTML.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const dom = new jsdom.JSDOM(html, { url: 'https://example.test/stella-nova/pages/tensor-calculus/index.html', pretendToBeVisual: true, virtualConsole: new jsdom.VirtualConsole() });
  const win = dom.window, doc = win.document;
  Object.defineProperty(win, 'innerWidth', { value: vp.w, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: vp.h, configurable: true });
  win.matchMedia = q => ({ matches: mediaMatch(q, vp), media: q, addEventListener() {}, removeEventListener() {} });
  win.HTMLElement.prototype.scrollIntoView = function () {};
  win.HTMLElement.prototype.scrollTo = function () {};
  const log = [];
  const { mods, views } = stubs(log);
  const importer = async p => { if (mods[p]) return mods[p]; throw new Error('no module ' + p); };
  const MAIN = await import(join(ROOT, 'main.js'));
  let rafFn = null, clock = 0;
  const b = await MAIN.boot({ doc, win, importer, typeset: (el, t) => { el.textContent = t; return Promise.resolve(true); }, raf: fn => { rafFn = fn; }, now: () => clock, noAnimate: true, saver: false });
  const tick = ms => { clock += ms; if (rafFn) rafFn(); };
  return { win, doc, b, log, views, tick };
}

const vpRows = [];
if (!jsdom) console.log('     skip jsdom: jsdom not found (set JSDOM_DIR or NODE_PATH)');
else for (const [w, h, coarse] of [...DESKTOP.map(([w, h]) => [w, h, false]), ...PHONES.map(([w, h]) => [w, h, true])]) {
  check(`jsdom ${w}x${h}${coarse ? ' touch' : ''}: data attributes, switch, player, tap pick`, async () => {
    const vp = { w, h, coarse };
    const { win, doc, b, log, views, tick } = await bootAt(vp);
    const api = win.tensorPage;
    const want = F.deviceOf(vp);
    assert.equal(doc.body.dataset.device, want, 'device');
    const st = await api.state();
    assert.equal(st.isPhone, want !== 'desktop');
    const plan = b.internals.fit.last();
    assert.ok(plan, 'a plan');
    for (const v of ['tex', 'viz', 'diagram']) {
      const lv = doc.getElementById({ tex: 'paneTex', viz: 'paneViz', diagram: 'paneDiagram' }[v]).dataset.head;
      assert.ok(LV.includes(lv), `${v} head ${lv}`);
      if (plan.panes[v]) assert.ok(F.headWidth(v, lv, { phone: want !== 'desktop' }) <= plan.panes[v].w, `${v} head fits`);
    }
    const fit = doc.getElementById('player').dataset.fit;
    if (want === 'desktop') {
      assert.equal(doc.getElementById('stage').dataset.shape, plan.shape);
      assert.ok(LV.includes(fit), 'player ' + fit);
      assert.deepEqual(st.views, ['tex', 'viz', 'diagram']);
    } else {
      assert.equal(fit, want === 'landscape' ? 'land' : 'phone');
      assert.equal(doc.getElementById('stage').dataset.shape, 'one');
      // the switch: Equation / 3D / Penrose; a tap scrolls to that view and
      // keeps all three in the row
      const btns = [...doc.querySelectorAll('#dockViews [data-layout]')];
      assert.deepEqual(btns.map(x => x.textContent), ['Equation', '3D', 'Penrose']);
      btns[1].click();
      assert.deepEqual((await api.state()).views, ['tex', 'viz', 'diagram']);
      assert.equal(b.phone.currentView(), 'viz');
      await api.setView('diagram');
      assert.deepEqual((await api.state()).views, ['tex', 'viz', 'diagram'], 'a focus spec on a phone keeps the row');
      assert.equal(b.phone.currentView(), 'diagram');
      // the sheet opens from the dock and holds the library
      doc.getElementById('dockPanel').click();
      assert.ok(doc.getElementById('panel').classList.contains('open'));
      assert.ok(!doc.getElementById('tabLibrary').hidden);
    }
    // the player: Prev, Play, Next, the label and Pause each step
    for (const id of ['pPrev', 'pPlay', 'pNext', 'pStepsBtn', 'pStepPause']) assert.ok(doc.getElementById(id) && !doc.getElementById(id).hidden, id);
    assert.equal(doc.getElementById('pStepPause').parentElement.textContent.trim(), 'Pause each step');
    tick(200);
    assert.match(doc.getElementById('pLabel').textContent, /Set nu = mu/);
    doc.getElementById('pNext').click();
    assert.equal((await api.state()).stepIndex, 1, 'Next');
    // a tap on an index glyph in the 3D view picks it in every view
    log.length = 0;
    views.viz.opts.onPick('mu');
    assert.equal((await api.state()).pickedIndex, 'mu');
    assert.ok(log.some(l => l[0] === 'diagram' && l[1] === 'pickIndex' && l[2] === 'mu'), 'diagram pick');
    assert.equal(doc.getElementById('texBody').dataset.pick, doc.body.dataset.pick, 'TeX pick');
    views.viz.opts.onPick('mu');
    assert.equal((await api.state()).pickedIndex, null, 'a second tap clears');
    b.stop();
    vpRows.push(`${w}x${h} ${want} shape ${doc.getElementById('stage').dataset.shape} player ${fit} heads ${['paneTex', 'paneViz', 'paneDiagram'].map(id => doc.getElementById(id).dataset.head).join('')}`);
    win.close();
  });
}

for (const [name, fn] of queue) {
  try { await fn(); pass++; } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 5).join('\n     ')); }
}
for (const r of rows) console.log('     plan ' + r);
for (const r of vpRows) console.log('     jsdom ' + r);
console.log(`layout: ${pass} pass, ${fail} fail (no browser ran)`);
process.exit(fail ? 1 : 0);
