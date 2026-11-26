// ============================================================================
//  FACET HEAD MODEL  ·  tests.mjs — node tests
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/facet-head-model/tests.mjs
//    1  the population: finite vertices, same seed gives the same heads, the
//       test pool does not change with N, blend weights sum to 1
//    2  exactness: the solve gives back a head from its own Laplacian and
//       positions; both models rebuild a training head at full rank; the
//       global model has N - 1 modes
//    3  the rank wall in the toy: below the latent dimension count the
//       global floor is far above the regional fit; above it the floor falls
//    4  the swap: no regions chosen gives A's own fit; a nose swap moves A
//       little away from the nose; the solve bends less at the cuts than
//       cut and paste
//    5  data.js: the counts and ratios in the text follow from the numbers,
//       FACET is lower in every E1 row, C < B < A in E2, and every number
//       the article quotes is in data.js
//    6  main.js boots in a DOM stub, builds 3 tables, runs every control
//       and the saver hook
// ============================================================================
import fs from 'fs';
import { population, regionWeights, N_V, LATENT_DIMS, REGIONS } from './head.js';
import { globalModel, regionalModel, curves, solve, laplacian, v2v, swap, cutPaste } from './model.js';
import { template } from './head.js';
import * as D from './data.js';

let fails = 0;
function check(name, ok, info) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; }
const here = new URL('.', import.meta.url);

// 1
{
  const a = population(24), b = population(24), c = population(40);
  const fin = [...a.train, ...a.test].every(h => h.length === 2 * N_V && h.every(Number.isFinite));
  const same = a.train.every((h, i) => h.every((x, j) => x === b.train[i][j]));
  const testFixed = a.test.every((h, i) => h.every((x, j) => x === c.test[i][j]));
  const W = regionWeights(); let wErr = 0;
  for (let v = 0; v < N_V; v++) { let s = 0; for (const w of W) s += w[v]; wErr = Math.max(wErr, Math.abs(s - 1)); }
  check('1 population', fin && same && testFixed && wErr < 1e-12, `finite ${fin}, seeded ${same}, test pool fixed ${testFixed}, weight sum error ${wErr.toExponential(1)}, ${LATENT_DIMS} latent dims`);
}
// 2
{
  const { train } = population(24), h = train[3];
  const e0 = v2v(solve(laplacian(h), h), h);
  const G = globalModel(train), R = regionalModel(train);
  const eg = v2v(G.fit(h, G.maxK), h), er = v2v(R.assemble(R.coeffs(h), R.perBasis), h);
  check('2 solve and full-rank rebuild', e0 < 1e-9 && eg < 1e-9 && er < 1e-9 && G.maxK === 23, `solve ${e0.toExponential(1)} mm, global ${eg.toExponential(1)} mm, regional ${er.toExponential(1)} mm; global modes ${G.maxK}, regional coefficients ${R.maxK}`);
}
// 3
{
  const floor = N => { const p = population(N), G = globalModel(p.train), R = regionalModel(p.train), c = curves(G, R, p.test); return [c.global.at(-1)[1], c.regional.at(-1)[1]]; };
  const [g24, r24] = floor(24), [g48] = floor(48);
  check('3 rank wall in the toy', g24 > 3 * r24 && g48 < 0.5 * g24, `N = 24: global floor ${g24.toFixed(2)} mm, regional ${r24.toFixed(2)} mm (${(g24 / r24).toFixed(1)}x); N = 48: global floor ${g48.toFixed(2)} mm`);
}
// 4
{
  const { train, test } = population(24), R = regionalModel(train), [a, b] = [test[0], test[1]];
  const fa = R.assemble(R.coeffs(a), R.perBasis), none = swap(R, a, b, []);
  const nose = REGIONS.findIndex(r => r.key === 'nose'), sw = swap(R, a, b, [nose]), cp = cutPaste(a, b, [nose]);
  const sp = template().span[nose];
  let far = 0; for (let v = 0; v < N_V; v++) if (v < sp[0] - 8 || v >= sp[1] + 8) far = Math.max(far, Math.hypot(sw[2 * v] - fa[2 * v], sw[2 * v + 1] - fa[2 * v + 1]));
  const kink = p => { const d = laplacian(p); return Math.max(...[sp[0], sp[1] - 1].map(v => Math.hypot(d[2 * v], d[2 * v + 1]))); };
  check('4 region swap', v2v(none, fa) < 1e-9 && far < 0.1 && kink(sw) < kink(cp), `empty swap = own fit; largest move away from the nose ${far.toFixed(3)} mm; bend at the cuts ${kink(sw).toFixed(2)} (solve) vs ${kink(cp).toFixed(2)} mm (cut and paste)`);
}
// 5
{
  const S = D.SETUP, row = (T, k) => T.rows.find(r => r[0] === k)[1];
  const claims = [
    ['global rank N - 1', S.globalRank === S.trainIds - 1],
    ['regional ceiling 16 * 2 * (N - 1)', S.regionalRank === S.regions * 2 * (S.trainIds - 1)],
    ['E1 ratio near 8.3', Math.abs(row(D.E1, 'Overall')[0] / row(D.E1, 'Overall')[1] / D.E1.ratio - 1) < 0.03],
    ['E3 ratio near 3.1', Math.abs(D.E3.rows[0][1][0] / D.E3.rows[0][1][1] / D.E3.ratio - 1) < 0.03],
    ['FACET lower in every E1 row', D.E1.rows.every(r => r[1][1] < r[1][0])],
    ['C < B < A in E2', D.E2.rows.every(([, v]) => v[2] < v[1] && v[1] < v[0])],
    ['whole head about equal in E3', Math.abs(D.E3.rows[1][1][0] - D.E3.rows[1][1][1]) < 0.1],
  ];
  const src = fs.readFileSync(new URL('data.js', here), 'utf8'), html = fs.readFileSync(new URL('index.html', here), 'utf8');
  const text = html.replace(/<!--[\s\S]*?-->/g, '').replace(/data-tex="[^"]*"/g, '').replace(/<meta[^>]*>/g, '');
  const quoted = [...new Set([...text.matchAll(/\b\d+\.\d{1,3}\b|\b\d{1,2},\d{3}\b/g)].map(m => m[0]))];
  const missing = quoted.filter(q => !src.includes(q) && !src.includes(q.replace(',', '')));
  const bad = claims.filter(c => !c[1]).map(c => c[0]);
  check('5 paper numbers and claims', !bad.length && !missing.length, `${quoted.length} quoted numbers, missing from data.js: [${missing.join(', ')}]; false claims: [${bad.join(', ')}]`);
}
// 6
{
  const els = new Map();
  const ctxStub = new Proxy({}, { get: (o, k) => k in o ? o[k] : () => {}, set: (o, k, v) => { o[k] = v; return true; } });
  const mk = id => {
    const e = { id, dataset: {}, style: { setProperty() {} }, textContent: '', innerHTML: '', value: '0', clientWidth: 400, clientHeight: 200, width: 0, height: 0, _kids: [],
      classList: { toggle() {}, add() {}, remove() {} }, getContext: () => ctxStub, appendChild(c) { e._kids.push(c); return c; },
      querySelectorAll: () => e._kids, addEventListener() {} };
    return e;
  };
  const get = id => { if (!els.has(id)) els.set(id, mk(id)); return els.get(id); };
  const tables = ['E1', 'E2', 'E3'].map(k => { const e = mk('t' + k); e.dataset.table = k; return e; });
  globalThis.window = globalThis; globalThis.devicePixelRatio = 1;
  globalThis.addEventListener = () => {}; globalThis.requestAnimationFrame = () => 0; globalThis.cancelAnimationFrame = () => {};
  globalThis.document = { getElementById: get, documentElement: mk('html'), querySelectorAll: q => q === '[data-table]' ? tables : [], createElement: t => mk(t) };
  let pending = null; globalThis.setTimeout = f => { pending = f; return 1; }; globalThis.clearTimeout = () => { pending = null; };
  let err = null, ticks = 0;
  try {
    await import('./main.js');
    for (const v of ['6', '35', '60', '24']) { get('nIn').value = v; get('nIn').oninput(); }
    for (const v of ['0', '500', '1000']) { get('kIn').value = v; get('kIn').oninput(); }
    get('nextHead').onclick(); get('prevHead').onclick();
    for (const b of get('regionChips')._kids) b.onclick();
    get('newPair').onclick();
    window.snSaver.enter({ seed: 3 });
    while (pending && ticks < 300) { const f = pending; pending = null; f(); ticks++; }
    window.snSaver.exit();
  } catch (e) { err = e; }
  const built = tables.every(t => t.innerHTML.includes('<table'));
  const nums = get('labNums').innerHTML.includes('Global ceiling') && get('swapNums').innerHTML.includes('Regions taken from B');
  check('6 main.js boots, builds tables, runs the controls and the saver', !err && built && nums && ticks >= 300 && !pending, err ? String(err.stack).split('\n').slice(0, 3).join(' / ') : `tables built: ${built}, readouts filled: ${nums}, ${REGIONS.length} region chips, ${ticks} saver ticks`);
}
console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
