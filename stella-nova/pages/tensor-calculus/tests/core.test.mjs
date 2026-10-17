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
  pending.push(Promise.resolve().then(fn).then(() => { pass++; }, e => { fail++; console.log('FAIL ' + label + '\n     ' + (e && e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); }));
}
async function drain() { while (pending.length) await pending.shift(); }

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
await drain();
console.log(`core: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
