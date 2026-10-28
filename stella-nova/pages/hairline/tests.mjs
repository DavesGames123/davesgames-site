// ============================================================================
//  HAIRLINE  ·  tests.mjs — node checks of the showcase page
// ----------------------------------------------------------------------------
//  Usage (repo root):
//    node stella-nova/pages/hairline/tests.mjs
//    NODE_PATH=<dir>/node_modules node stella-nova/pages/hairline/tests.mjs
//  With jsdom on NODE_PATH, part 5 mounts every figure and boots main.js.
//  Without jsdom, part 5 is skipped and the run says so. Exit 1 on failure.
//
//  1. vendor/hairline.js is the npm 0.5.1 bundle (SHA-256), with no imports,
//     and the MIT licence file names Lucas Marques
//  2. catalog: 33 figures, each a function export of the bundle, each
//     export a figure, groups and palettes valid
//  3. code.js snippets: defaults left out, options written, CSS palette
//  4. saver maths: shuffle, fitBox in 16:9 and 9:16, planShot ranges,
//     mirror styleText
//  5. jsdom: every figure mounts an svg, update() and destroy() work,
//     main.js boots, the gallery has 33 cards and the focus view opens
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log('FAIL ' + msg); } };

// 1
const bundle = fs.readFileSync(path.join(DIR, 'vendor/hairline.js'));
const { REPO, FIGURES, GROUPS, PALETTES, PALETTE_KEYS } = await import('./catalog.js');
ok(crypto.createHash('sha256').update(bundle).digest('hex') === REPO.sha256, 'bundle sha256');
ok(!/^\s*import\s/m.test(bundle.toString()), 'bundle has no imports');
ok(/MIT License[\s\S]*Lucas Marques/.test(fs.readFileSync(path.join(DIR, 'vendor/LICENSE-hairline.txt'), 'utf8')), 'licence file');

// 2
const exportLine = bundle.toString().match(/export \{([^}]*)\}/)[1];
const exported = exportLine.split(',').map(s => s.trim()).filter(s => s && !s.startsWith('type '));
ok(FIGURES.length === 33, 'figure count ' + FIGURES.length);
ok(new Set(FIGURES.map(f => f.fn)).size === 33, 'figure fns unique');
for (const f of FIGURES) ok(exported.includes(f.fn), 'export ' + f.fn);
for (const e of exported) ok(FIGURES.some(f => f.fn === e), 'catalogued ' + e);
for (const f of FIGURES) {
  ok(GROUPS.some(g => g.id === f.group && g.id !== 'all'), 'group ' + f.fn);
  ok(f.name.toLowerCase() === f.fn, 'name ' + f.fn);
  ok(f.what.length > 20 && f.more.length > 8, 'text ' + f.fn);
}
for (const g of GROUPS) if (g.id !== 'all') ok(FIGURES.some(f => f.group === g.id), 'group used ' + g.id);
for (const p of PALETTES) {
  ok(p.theme === 'dark' || p.theme === 'light', 'theme ' + p.id);
  for (const k of PALETTE_KEYS) ok(/^#[0-9a-f]{6}$/.test(p.vars[k]), `palette ${p.id}.${k}`);
}

// 3
const { snippet, KINDS } = await import('./code.js');
const terrain = FIGURES.find(f => f.fn === 'terrain');
const js0 = snippet('js', terrain, { intensity: 0.5 });
ok(js0.includes('terrain(document.getElementById("figure"))'), 'js default has no options');
ok(snippet('js', terrain, { intensity: 0.8, play: true }).includes('{ intensity: 0.8, play: true }'), 'js options');
ok(snippet('react', terrain, {}).includes('<Terrain />') && snippet('react', terrain, {}).includes('@lucasmarkes/hairline/react'), 'react default');
ok(snippet('react', terrain, { intensity: 0.25, play: true, theme: 'dark' }).includes('<Terrain intensity={0.25} theme="dark" play />'), 'react props');
ok(snippet('svelte', terrain, { intensity: 0.7 }).includes('use:terrain={{ intensity: 0.7 }}'), 'svelte');
const css = snippet('css', terrain, { vars: PALETTES[2].vars, stroke: 1.2 });
ok(css.includes('--hairline-plate: #0b2340;') && css.includes('--hairline-stroke: 1.2;'), 'css');
ok(KINDS.every(k => snippet(k.id, terrain, {}).length > 20), 'every kind');

// 4  (saver.js imports the bundle and lib/saver-clear.js; both load in node)
const { shuffle, mulberry, fitBox, planShot } = await import('./saver.js');
const s1 = shuffle(FIGURES, mulberry(7)).map(f => f.fn), s2 = shuffle(FIGURES, mulberry(7)).map(f => f.fn), s3 = shuffle(FIGURES, mulberry(8)).map(f => f.fn);
ok(s1.join() === s2.join() && s1.join() !== s3.join(), 'shuffle seeded');
ok([...s1].sort().join() === FIGURES.map(f => f.fn).sort().join(), 'shuffle keeps all');
for (const [W, Hh, band] of [[1280, 800, null], [1280, 800, { t: 260, b: 220 }], [450, 800, null], [450, 800, { t: 230, b: 210 }], [1080, 1920, { t: 500, b: 500 }]]) {
  const b = fitBox(W, Hh, band);
  const t = band ? band.t : Hh * 0.12;
  ok(Math.abs(b.w / b.h - 1.25) < 1e-9, `fitBox aspect ${W}x${Hh}`);
  ok(b.x >= 0 && b.x + b.w <= W + 1e-6 && b.w <= W * 0.92 + 1e-6, `fitBox inside x ${W}x${Hh}`);
  ok(b.y >= t - 1e-6 && b.y + b.h <= Hh - (band ? Math.min(band.b, Hh - t - Hh * 0.3) : Hh * 0.12) + 1e-6, `fitBox in band ${W}x${Hh}`);
  ok(b.w > W * 0.3, `fitBox not tiny ${W}x${Hh}`);
}
const rng = mulberry(3);
for (let i = 0; i < 200; i++) {
  const s = planShot(rng, i % 2, FIGURES[i % 33], PALETTES[i % PALETTES.length]);
  ok(s.intensity >= 0.35 && s.intensity <= 0.9 && s.seconds >= 6 && s.seconds <= 11, 'planShot range ' + i);
}
const { styleText, svgImage } = await import('./mirror.js');
const st = styleText(PALETTES[3].vars, 1.8);
ok(st.includes('stroke-width:1.8') && st.includes(PALETTES[3].vars.plate) && !st.includes('var('), 'styleText plain values');

// 5
let JSDOM = null;
try { JSDOM = createRequire(import.meta.url)('jsdom').JSDOM; } catch (e) {
  try { JSDOM = createRequire(path.join(process.env.NODE_PATH || '.', 'x.js'))('jsdom').JSDOM; } catch (e2) {}
}
if (!JSDOM) console.log('SKIP part 5: jsdom does not resolve (set NODE_PATH)');
else {
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/stella-nova/pages/hairline/', pretendToBeVisual: true });
  const w = dom.window;
  w.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const errors = [];
  w.addEventListener('error', e => errors.push(e.message));
  for (const k of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'SVGElement', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'CSSStyleSheet', 'XMLSerializer', 'innerWidth', 'innerHeight', 'localStorage', 'addEventListener', 'devicePixelRatio', 'Image'])
    Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true });
  // jsdom has no IntersectionObserver: report each target on screen on the next microtask.
  w.IntersectionObserver = globalThis.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; this.on = true; }
    observe(t) { queueMicrotask(() => { if (this.on) this.cb([{ target: t, isIntersecting: true }], this); }); }
    unobserve() {} disconnect() { this.on = false; }
  };
  const Hm = await import(pathToFileURL(path.join(DIR, 'vendor/hairline.js')).href);
  for (const f of FIGURES) {
    const host = w.document.createElement('div');
    w.document.body.appendChild(host);
    let read = null;
    try {
      const fig = Hm[f.fn](host, { intensity: 0.7, theme: 'dark', onRead: t => { read = t; } });
      ok(!!host.querySelector('svg') && host.querySelector('svg').querySelectorAll('path,polygon,ellipse,line,circle').length > 3, 'svg drawn ' + f.fn);
      ok(host.hasAttribute('data-hairline'), 'host marked ' + f.fn);
      if (f.fn === 'vault') {
        const url = svgImage(host.querySelector('svg'), 500, 400, PALETTES[0].vars, 1.8);
        const txt = decodeURIComponent(url.split(',')[1]);
        ok(url.startsWith('data:image/svg+xml') && txt.includes('<style') && txt.includes('width="500"') && txt.includes('xmlns="http://www.w3.org/2000/svg"'), 'svgImage serialises');
      }
      fig.update({ intensity: 0.2, play: true });
      fig.destroy(); fig.destroy();
      ok(!host.querySelector('svg') && !host.hasAttribute('data-hairline'), 'destroy cleans ' + f.fn);
      ok(typeof read === 'string', 'onRead at mount ' + f.fn);
    } catch (e) { ok(false, 'mount ' + f.fn + ': ' + e.message); }
    host.remove();
  }
  // boot main.js against the page DOM
  try {
    await import(pathToFileURL(path.join(DIR, 'main.js')).href);
    await new Promise(r => setTimeout(r, 20));
    const d = w.document;
    ok(d.querySelectorAll('#grid .card').length === 33, 'gallery cards');
    ok(d.querySelectorAll('#filters button').length === GROUPS.length, 'filters');
    ok(d.querySelectorAll('#palettes button').length === PALETTES.length, 'palettes');
    ok(!!d.querySelector('#heroFig svg'), 'hero figure');
    ok(d.getElementById('noscript').hidden, 'noscript hidden');
    const api = w.__hairline || globalThis.__hairline;
    api.openFocus('vault');
    ok(!d.getElementById('focus').hidden && !!d.querySelector('#focusFig svg'), 'focus opens');
    ok(d.getElementById('code').textContent.includes('vault('), 'focus code');
    api.closeFocus();
    ok(d.getElementById('focus').hidden && !d.querySelector('#focusFig svg'), 'focus closes');
    d.querySelector('#filters button[data-id="graph"]').click();
    ok([...d.querySelectorAll('#grid .card')].filter(c => !c.hidden).length === FIGURES.filter(f => f.group === 'graph').length, 'filter graph');
    ok(typeof (w.snSaver || globalThis.snSaver)?.enter === 'function', 'saver hook');
    const sv = w.snSaver, labels = [];
    const got = sv.enter({ calm: 0.5, seed: 11, label: x => labels.push(x) });
    ok(got.canvas && got.canvas.isConnected && got.canvas.id === 'saverCanvas', 'saver canvas in document');
    ok(d.documentElement.classList.contains('saver-on') && !!d.querySelector('#saverStage svg'), 'saver figure');
    ok(labels.some(x => x && x.title && x.sub.includes('Lucas Marques')), 'saver label credit');
    sv.exit();
    ok(!d.getElementById('saverStage') && !d.documentElement.classList.contains('saver-on') && labels[labels.length - 1] === null, 'saver exit');
  } catch (e) { ok(false, 'main.js boot: ' + e.stack); }
  ok(errors.length === 0, 'window errors: ' + errors.join(' | '));
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
