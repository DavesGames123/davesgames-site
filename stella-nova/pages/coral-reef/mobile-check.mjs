// ============================================================================
//  CORAL REEF  ·  phone checks in jsdom (no browser):  node mobile-check.mjs
// ----------------------------------------------------------------------------
//  Needs jsdom 24 (npm i jsdom@24.1.3 in a scratch folder, then give that
//  folder as JSDOM_DIR or NODE_PATH). It skips with a message if jsdom is
//  not found.
//
//  For each viewport (360x740, 390x844, 430x932, 768x1024, 844x390 on a
//  coarse pointer, and 1440x900 with a mouse) it loads index.html, sets
//  the window size and a matchMedia that reads the size, and imports the
//  real main.js. jsdom has no WebGL, so scene.js gives no scene and the
//  page runs without the reef render. The shell, the dock, the sheet, the
//  chips, the gradient picker and the reef model run as on a phone.
//    dock ......... five buttons with labels: preset, grow, regrow, plant, menu
//    sheet ........ menu opens the half sheet; the grip drags it to full,
//                   back to half and closed; Escape closes it
//    plant ........ plant mode on and off, the plant bar, the species chips
//    explainer .... opens over the sheet, closes with Escape
//    css .......... 44 px targets and 11 px text in the touch block,
//                   safe-area insets, no fixed widths over the viewport
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire, register } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The importmap of index.html, for node: 'three' and 'three/addons/'.
const VENDOR = pathToFileURL(path.join(HERE, '../../vendor/three@0.160.0/')).href;
register('data:text/javascript,' + encodeURIComponent(`
  const V = ${JSON.stringify(VENDOR)};
  export async function resolve(s, c, n) {
    if (s === 'three') return n(V + 'build/three.module.js', c);
    if (s.startsWith('three/addons/')) return n(V + 'examples/jsm/' + s.slice(13), c);
    return n(s, c);
  }`));
const require = createRequire(import.meta.url);
let JSDOM;
try {
  const dirs = [process.env.JSDOM_DIR, ...(process.env.NODE_PATH || '').split(path.delimiter)].filter(Boolean);
  ({ JSDOM } = require(require.resolve('jsdom', { paths: dirs.length ? dirs : undefined })));
} catch (e) {
  console.log('mobile-check: SKIPPED, jsdom not found (set JSDOM_DIR or NODE_PATH)');
  process.exit(0);
}

let pass = 0, fail = 0;
function ok(cond, name, info = '') {
  if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); }
}

// matchMedia for a size: (max-width), (max-height), (min-width), (pointer),
// (orientation), (prefers-reduced-motion). Comma = or, 'and' = and.
function mediaFor(w, h, coarse) {
  const feat = f => {
    const m = f.trim().replace(/^\(|\)$/g, '').split(':').map(s => s.trim());
    const [k, v] = m, n = parseFloat(v);
    if (k === 'max-width') return w <= n;
    if (k === 'min-width') return w >= n;
    if (k === 'max-height') return h <= n;
    if (k === 'min-height') return h >= n;
    if (k === 'pointer') return (v === 'coarse') === coarse;
    if (k === 'orientation') return (v === 'landscape') === (w > h);
    return false;
  };
  return q => ({
    matches: q.split(',').some(part => part.split(/\band\b/).every(feat)),
    media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
}

const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
const VIEWS = [[360, 740, true], [390, 844, true], [430, 932, true], [768, 1024, true], [844, 390, true], [1440, 900, false]];
let run = 0;

for (const [w, h, coarse] of VIEWS) {
  const tag = `${w}x${h}${coarse ? '' : ' mouse'}`;
  const phone = w <= 768 || (h <= 500 && coarse);
  const dom = new JSDOM(html.replace(/<script type="module"[^>]*><\/script>/, ''), { url: pathToFileURL(path.join(HERE, 'index.html')).href, pretendToBeVisual: true });
  const win = dom.window;
  Object.defineProperty(win, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: h, configurable: true });
  win.matchMedia = mediaFor(w, h, coarse);
  win.HTMLCanvasElement.prototype.getContext = () => null;     // no WebGL, no 2D canvas
  // the globals main.js reads
  const G = globalThis;
  for (const k of ['window', 'document', 'navigator', 'getComputedStyle', 'requestAnimationFrame', 'HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent']) {
    Object.defineProperty(G, k, { value: k === 'window' ? win : (typeof win[k] === 'function' && /^[a-z]/.test(k) ? win[k].bind(win) : win[k]), configurable: true, writable: true });
  }
  G.matchMedia = win.matchMedia;
  G.addEventListener = win.addEventListener.bind(win);
  G.devicePixelRatio = 3;
  G.innerWidth = w; G.innerHeight = h;
  const errs = [], cerr = console.error;
  console.error = (...a) => { if (!/^THREE\.WebGLRenderer/.test(String(a[0]))) cerr(...a); };
  try {
    await import(pathToFileURL(path.join(HERE, 'main.js')).href + `?v=${run++}`);
  } catch (e) { errs.push(e); }
  console.error = cerr;
  ok(errs.length === 0, `${tag}: main.js runs in jsdom with no scene`, errs.map(e => e.stack).join('\n'));
  if (errs.length) continue;
  const doc = win.document, $ = id => doc.getElementById(id);
  const click = id => $(id).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok(!$('nogl').hidden, `${tag}: no WebGL shows the message (jsdom has none)`);

  // dock
  const dock = [...doc.querySelectorAll('#dock > button')];
  ok(dock.map(b => b.id).join() === 'dockPreset,dockPlay,dockRegrow,dockPlant,dockMenu', `${tag}: the dock has preset, grow, regrow, plant, menu`, dock.map(b => b.id).join());
  ok(dock.every(b => b.getAttribute('aria-label') && b.querySelector('span').textContent.trim()), `${tag}: each dock button has a label`);
  const panel = $('panel');
  ok(panel.classList.contains('open') === !phone, `${tag}: the panel is ${phone ? 'closed' : 'open'} at load`);
  ok($('adv').open === !phone, `${tag}: the dlaf parameters are ${phone ? 'closed' : 'open'} at load`);
  ok($('dockPlant').getAttribute('aria-pressed') === String(!coarse) && doc.body.classList.contains('planting') === !coarse, `${tag}: plant mode is ${coarse ? 'off' : 'on'} at load`);

  // grow, pause, preset
  click('dockPlay');
  ok(/Grow/.test($('dockPlay').textContent) && /Grow/.test($('bPlay').textContent), `${tag}: the dock pauses the growth`);
  click('dockPlay');
  ok(/Pause/.test($('dockPlay').textContent), `${tag}: the dock starts the growth again`);
  const p0 = $('dockPresetName').textContent;
  click('dockPreset');
  ok($('dockPresetName').textContent !== p0 && doc.querySelector('#presets button.on').textContent.startsWith($('dockPresetName').textContent), `${tag}: the dock preset button goes to the next preset`, `${p0} -> ${$('dockPresetName').textContent}`);
  click('dockRegrow');
  ok(/Pause/.test($('dockPlay').textContent), `${tag}: regrow keeps the growth on`);

  // the sheet
  if (phone) {
    click('dockMenu');
    ok(panel.classList.contains('open') && !panel.classList.contains('full') && $('dockMenu').getAttribute('aria-expanded') === 'true', `${tag}: menu opens the half sheet`);
    const grip = $('sheetGrip');
    const drag = dy => {
      grip.dispatchEvent(new win.MouseEvent('pointerdown', { clientY: 400, bubbles: true }));
      grip.dispatchEvent(new win.MouseEvent('pointermove', { clientY: 400 + dy, bubbles: true }));
      grip.dispatchEvent(new win.MouseEvent('pointerup', { clientY: 400 + dy, bubbles: true }));
    };
    drag(-90); ok(panel.classList.contains('full'), `${tag}: the grip drags the sheet to full height`);
    drag(90); ok(panel.classList.contains('open') && !panel.classList.contains('full'), `${tag}: the grip drags it back to half`);
    drag(90); ok(!panel.classList.contains('open') && doc.body.classList.contains('panel-closed'), `${tag}: the grip drags it closed`);
    ok(panel.style.transform === '', `${tag}: no drag offset stays on the sheet`);
    click('dockMenu');
    win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
    ok(!panel.classList.contains('open'), `${tag}: Escape closes the sheet`);
    for (const g of ['colour', 'water', 'reef', 'species']) ok(panel.querySelector(`.grp[data-grp=${g}]`), `${tag}: the sheet holds the ${g} group`);
    ok(['gradPick', 'modes', 'sDir', 'sCur', 'sNut', 'sTemp', 'tCaust', 'spParams'].every(id => panel.contains($(id))), `${tag}: gradient, colour by, current, nutrients, temperature, caustics, dlaf parameters are in the sheet`);
    ok(panel.querySelectorAll('#spParams input[type=range]').length === 5 && $('adv').contains($('spParams')), `${tag}: the five dlaf parameters are in the advanced section`);
  }

  // plant mode
  const wasPlant = doc.body.classList.contains('planting');
  if (wasPlant) click('dockPlant');
  if (phone) click('dockMenu');
  click('dockPlant');
  ok(doc.body.classList.contains('planting') && !$('plantBar').hidden && $('tPlant').classList.contains('on'), `${tag}: the dock turns plant mode on, with the plant bar`);
  if (phone) ok(!panel.classList.contains('open'), `${tag}: plant mode closes the sheet, so the seabed is clear`);
  const quick = [...$('plantQuick').querySelectorAll('button')];
  ok(quick.length === 5, `${tag}: the plant bar has the five species`, quick.length);
  quick[1].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok(doc.querySelector('#plant button.on').dataset.id === quick[1].dataset.id && /sea fan/i.test($('plantMsg').textContent), `${tag}: a plant bar chip picks the species everywhere`, $('plantMsg').textContent);
  click('plantDone');
  ok(!doc.body.classList.contains('planting') && $('plantBar').hidden && $('dockPlant').getAttribute('aria-pressed') === 'false', `${tag}: Done ends plant mode`);

  // explainer
  if (phone) click('dockMenu');
  click('aboutOpen');
  ok(!$('about').hidden && (!phone || !panel.classList.contains('open')), `${tag}: the explainer opens${phone ? ' and the sheet closes' : ''}`);
  ok($('about').querySelector('.ab-head #aboutClose'), `${tag}: the explainer close button is in its sticky head`);
  win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
  ok($('about').hidden, `${tag}: Escape closes the explainer`);
  win.close();
}

// ── css ─────────────────────────────────────────────────────────────────────
{
  const css = fs.readFileSync(path.join(HERE, 'style.css'), 'utf8');
  const block = (start) => {
    const i = css.indexOf(start); if (i < 0) return '';
    let d = 0, j = css.indexOf('{', i);
    for (let k = j; k < css.length; k++) { if (css[k] === '{') d++; else if (css[k] === '}' && --d === 0) return css.slice(j, k + 1); }
    return '';
  };
  const touch = block('@media (pointer:coarse), (max-width:768px)');
  const phoneB = block('@media (max-width:768px), (max-height:500px) and (pointer:coarse)');
  ok(touch && phoneB, 'css: the touch block and the phone block are there');
  for (const sel of ['.chips button', '#adv summary', '.linkbtn', '.row{min-height:44px', '#aboutClose{width:44px;height:44px', '#panelClose{width:44px;height:44px']) ok(touch.includes(sel), `css: the touch block sizes ${sel.split('{')[0]} to 44 px`);
  ok(/::-webkit-slider-thumb\{[^}]*width:26px;height:26px/.test(touch) && /input\[type=range\][^{]*\{[^}]*height:44px/.test(touch), 'css: thumb sliders, 26 px thumbs on a 44 px track');
  ok(/#dock > button\{[^}]*height:48px/.test(phoneB) && /#sheetGrip\{[^}]*height:44px/.test(phoneB) && /#plantDone\{[^}]*min-height:44px/.test(phoneB), 'css: dock buttons 48 px, grip and Done 44 px');
  ok(['safe-area-inset-bottom', 'safe-area-inset-left', 'safe-area-inset-right', 'safe-area-inset-top'].every(s => phoneB.includes(s)), 'css: the phone block uses all four safe-area insets');
  const small = [...css.matchAll(/font(?:-size)?:\s*(?:\d+\s+)?([\d.]+)rem/g)].map(m => +m[1]).filter(v => v < 0.6875);
  ok(small.length === 0, 'css: no text under 11 px (0.6875rem)', small.join());
  const wide = [...css.matchAll(/(?:^|[;{])\s*(?:min-)?width:\s*(\d+)px/g)].map(m => +m[1]).filter(v => v > 360);
  ok(wide.length === 0, 'css: no fixed width over 360 px', wide.join());
  ok(/html,body\{[^}]*overflow:hidden/.test(css) && /#panel\{[^}]*overflow-x:hidden/.test(css) && /#about\{[^}]*overflow-x:hidden/.test(css), 'css: no horizontal scroll on the page, the panel or the explainer');
}

console.log(`mobile-check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);          // the page timers of the closed windows do not run
