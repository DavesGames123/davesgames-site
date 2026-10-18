// CNN Explainer · tests/page.test.mjs
// Boots the page in jsdom at a desktop and a phone size, with a stub 2D
// canvas context, and checks: no errors, the first prediction, every
// example, the detail view of each layer type, the keyboard, hover tips,
// colours and the explainer widgets.
// Needs jsdom on NODE_PATH (or JSDOM_DIR); without it the test SKIPs and
// exits 1, so a run without jsdom never passes as green.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, '..');
let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) pass++; else { fail++; console.log('FAIL  ' + m + (d ? '  ' + d : '')); } };

let JSDOM = null, VirtualConsole = null;
for (const base of [process.env.JSDOM_DIR, process.env.NODE_PATH && path.join(process.env.NODE_PATH, 'jsdom')].filter(Boolean)) {
  try { ({ JSDOM, VirtualConsole } = createRequire(path.join(base, 'package.json'))(base)); break; } catch (e) { /* next */ }
}
if (!JSDOM) { console.log('SKIP  page: jsdom not found (set NODE_PATH or JSDOM_DIR)'); console.log('page: 0 passed, 1 failed'); process.exit(1); }

// a 2D context that does nothing but keeps image data shapes and counts calls
function fakeContext(calls) {
  const base = {
    canvas: null,
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(128) }),
    measureText: s => ({ width: String(s).length * 6 }),
    setLineDash() {}, getLineDash: () => [],
  };
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string' && /^[a-z]/.test(k) && !['fillStyle', 'strokeStyle', 'font', 'lineWidth', 'globalAlpha', 'textAlign', 'textBaseline', 'imageSmoothingEnabled'].includes(k)) {
        return (...a) => { calls[k] = (calls[k] || 0) + 1; if (k === 'drawImage' && (!a[0] || a[0].width == null)) throw new Error('drawImage of a non-image'); };
      }
      return t['_' + String(k)];
    },
    set(t, k, v) { t['_' + String(k)] = v; return true; },
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function bootAt({ name, width, height, phone }) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Not implemented: (HTMLCanvasElement|window.scrollTo|HTMLMediaElement)/.test(e.message)) errors.push('jsdom: ' + e.message); });
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  const html = fs.readFileSync(path.join(PAGE, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: pathToFileURL(path.join(PAGE, 'index.html')).href, pretendToBeVisual: true, virtualConsole: vc });
  const win = dom.window;
  const calls = {};
  win.HTMLCanvasElement.prototype.getContext = function () { if (!this.__ctx) { this.__ctx = fakeContext(calls); } return this.__ctx; };
  win.innerWidth = width; win.innerHeight = height;
  win.matchMedia = q => ({ matches: q.includes('max-width: 768px') ? phone : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {} });
  win.__cnnNoAutoBoot = true;
  win.__cnnLoadBytes = async url => new Uint8Array(fs.readFileSync(fileURLToPath(url)));
  win.addEventListener('error', e => errors.push('window error: ' + (e.error && e.error.stack || e.message)));
  // the page modules read these globals at call time
  globalThis.window = win; globalThis.document = win.document;
  for (const k of ['HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle']) {
    try { globalThis[k] = win[k]; } catch (e) { /* read-only in this node */ }
  }
  const origErr = console.error; console.error = (...a) => { errors.push('console.error: ' + a.map(String).join(' ')); };
  const origWarn = console.warn; const warns = []; console.warn = (...a) => { warns.push(a.map(String).join(' ')); };
  const mod = await import(pathToFileURL(path.join(PAGE, 'main.js')).href);
  let page = null;
  try { page = await mod.boot(); } catch (e) { errors.push('boot threw: ' + e.stack); }
  await wait(120);
  return { dom, win, doc: win.document, page, errors, warns, calls, restore() { console.error = origErr; console.warn = origWarn; dom.window.close(); } };
}

for (const size of [{ name: 'desktop 1280x800', width: 1280, height: 800, phone: false }, { name: 'phone 390x844', width: 390, height: 844, phone: true }]) {
  const T = await bootAt(size), { win, doc, page } = T, N = size.name;
  try {
    ok(page && page.state.booted && !page.state.failed, `${N}: booted`, String(page && page.state.failed));
    ok(page.state.result && page.state.result.label === 'espresso', `${N}: the first photo is an espresso`, page.state.result && page.state.result.label);
    ok(/espresso/.test(doc.getElementById('pred').textContent), `${N}: the topbar names the answer`, doc.getElementById('pred').textContent);
    ok(doc.querySelectorAll('#stripEx .ex-btn').length === 20, `${N}: 20 example buttons`);
    ok(doc.querySelector('#stripEx .ex-btn[aria-checked="true"]').dataset.i === '12', `${N}: the espresso button is checked`);
    ok(doc.querySelectorAll('#learnBody .ex-sec').length >= 8, `${N}: the explainer has its sections`);
    ok(doc.querySelector('.pg-cv') && doc.querySelector('.act-plot'), `${N}: the playground and activation widgets are there`);
    ok(T.calls.drawImage > 50, `${N}: the overview drew the maps`, String(T.calls.drawImage));
    const L = page.state.L;
    ok(L && L.orient === (size.phone ? 'v' : 'h'), `${N}: layout ${size.phone ? 'blocks' : 'columns'}`, L && L.orient);
    if (size.phone) {
      ok(!doc.getElementById('learn').classList.contains('open'), `${N}: the explainer sheet starts closed`);
      ok(parseInt(doc.getElementById('netCv').style.height, 10) === L.h, `${N}: the canvas is as tall as the blocks`);
      doc.getElementById('dockLearn').click();
      ok(doc.getElementById('learn').classList.contains('open'), `${N}: Learn opens the sheet`);
      doc.getElementById('dockLearn').click();
    } else {
      ok(doc.getElementById('learn').classList.contains('open'), `${N}: the explainer column is open`);
    }
    // every example: top-1 is its class
    const wrong = [];
    page.examples.forEach((ex, i) => { const r = page.runExample(i); if (r.label !== ex.cls) wrong.push(i + ':' + r.label); });
    ok(wrong.length === 0, `${N}: each example is classified as its class`, wrong.join(' '));
    page.runExample(12);
    // hover: a tip with a value, and links drawn
    const m = L.maps.find(q => q.li === 6 && q.c === 2);
    const cv = doc.getElementById('netCv');
    cv.dispatchEvent(new win.MouseEvent('pointermove', { clientX: m.x + m.s / 2, clientY: m.y + m.s / 2, bubbles: true }));
    await wait(40);
    ok(page.state.hover && page.state.hover.li === 6 && page.state.hover.c === 2, `${N}: hover finds Conv 2·1 map 3`, JSON.stringify(page.state.hover));
    if (!size.phone) ok(!doc.getElementById('netTip').hidden && /Conv 2·1/.test(doc.getElementById('netTip').textContent), `${N}: the tip names the map`, doc.getElementById('netTip').textContent);
    // click opens the detail view at that cell
    cv.dispatchEvent(new win.MouseEvent('click', { clientX: m.x + m.s / 2, clientY: m.y + m.s / 2, bubbles: true }));
    await wait(60);
    ok(!doc.getElementById('detail').hidden && doc.getElementById('detail').dataset.kind === 'conv', `${N}: a click opens the conv detail`);
    ok(/Conv 2·1/.test(doc.getElementById('detailTitle').textContent), `${N}: the detail title`, doc.getElementById('detailTitle').textContent);
    // every layer type plays a few frames with no error
    for (const [li, c, kind] of [[0, -1, 'input'], [1, 0, 'conv'], [2, 3, 'relu'], [5, 9, 'pool'], [10, 1, 'pool'], [11, null, 'dense']]) {
      const before = T.errors.length, warn0 = T.warns.length;
      page.openDetail({ li, c });
      await wait(80);
      doc.getElementById('dNext').click(); doc.getElementById('dNext').click();
      ok(doc.getElementById('detail').dataset.kind === kind && T.errors.length === before && !T.warns.slice(warn0).some(w => /detail frame/.test(w)), `${N}: detail of layer ${li} (${kind}) runs`, T.errors.slice(before).concat(T.warns.slice(warn0)).join(' | '));
      ok(doc.getElementById('detailText').textContent.length > 60, `${N}: detail of layer ${li} has its text`);
    }
    ok(/score|probability/.test(doc.getElementById('detailLive').textContent), `${N}: the live line speaks the softmax`, doc.getElementById('detailLive').textContent);
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok(doc.getElementById('detail').hidden, `${N}: Esc closes the detail view`);
    // keyboard on the overview: the focus starts on the last opened map
    page.openDetail({ li: 1, c: 0 }); doc.getElementById('dClose').click();
    cv.focus();
    cv.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    cv.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    ok(/ReLU 1·1, map 2 of 10/.test(doc.getElementById('netLive').textContent), `${N}: arrow keys move the focus`, doc.getElementById('netLive').textContent);
    cv.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    ok(!doc.getElementById('detail').hidden && doc.getElementById('detail').dataset.kind === 'relu', `${N}: Enter opens the focused map`);
    doc.getElementById('dClose').click();
    // colours: a new gradient and scale repaint the maps
    const d0 = T.calls.putImageData || 0;
    doc.getElementById('viewBtn').click();
    ok(!doc.getElementById('viewPop').hidden, `${N}: Colours opens the pop-up`);
    doc.querySelector('#gradHost .gg-sw[data-id="viridis"]').click();
    doc.querySelector('#scaleSeg button[data-id="map"]').click();
    ok(page.state.grad === 'viridis' && page.state.scale === 'map' && (T.calls.putImageData || 0) > d0 + 100, `${N}: gradient and scale repaint`, `${page.state.grad} ${page.state.scale} ${(T.calls.putImageData || 0) - d0}`);
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok(doc.getElementById('viewPop').hidden, `${N}: Esc closes the pop-up`);
    // the playground answers its sliders
    const pg = doc.querySelector('.pg'); const sl = pg.querySelector('input[data-k="s"]');
    sl.value = '2'; pg.dispatchEvent(new win.Event('input', { bubbles: true }));
    ok(/Output 3 × 3|stride/.test(pg.querySelector('.pg-note').textContent), `${N}: the playground note follows the stride`, pg.querySelector('.pg-note').textContent);
    const act = doc.querySelector('.act'); act.querySelector('button[data-id="sigmoid"]').click();
    ok(/Squeezes/.test(act.querySelector('.act-note').textContent), `${N}: the activation picker changes`);
    // credits
    doc.getElementById('creditsBtn').click();
    ok(!doc.getElementById('credits').hidden && doc.querySelectorAll('#creditsBody .cr-photos a').length === 20 && /MIT/.test(doc.getElementById('creditsBody').textContent), `${N}: credits list the photos and the MIT licence`);
    doc.getElementById('creditsClose').click();
    ok(T.errors.length === 0, `${N}: no errors`, T.errors.slice(0, 5).join(' | '));
  } catch (e) {
    ok(false, `${N}: test threw`, e.stack);
  } finally { T.restore(); }
}

console.log(`page: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
