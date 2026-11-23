// ============================================================================
//  AUTOREGRESSIVE VIEW MODEL  ·  tests.mjs — node tests
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/autoregressive-view-model/tests.mjs
//    1  raycast: a ray from the middle hits the nearest wall at the right
//       distance; every view of every path has finite columns
//    2  stream bookkeeping: sink <= L_sin prefill views, motion = the last
//       L_mot history views, no view twice in the context, L adds up,
//       retrieved views never include sink or motion
//    3  greedy and spatial keep to the budget min(s L_tgt, |R|); the
//       angular pass adds at most four
//    4  with no context at all a chunk imagines every column; with a prefill
//       view at the target pose it copies every column
//    5  the retrieval ablation: on Out and back, spatial + angular keeps
//       revisits far more consistent than L_rtr = 0 (paper Table 6)
//    6  data.js: table shapes, and every number the article quotes is in
//       data.js; the "best" claims in the text hold in the tables
//    7  main.js boots in a DOM stub, builds 6 tables, plays to the end
// ============================================================================
import fs from 'fs';
import { raycast, observe, PATHS, prefillFor, SEGS } from './world.js';
import { createStream, REVISIT_GAP } from './stream.js';
import * as D from './data.js';

let fails = 0;
function check(name, ok, info) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; }
const here = new URL('.', import.meta.url);

// 1
{
  const h = raycast(10, 1, -Math.PI / 2);
  let fin = true, nv = 0;
  for (const k of Object.keys(PATHS)) for (const p of PATHS[k].poses()) { nv++; for (const c of observe(p)) if (c.key < 0 || !Number.isFinite(c.dist)) fin = false; }
  check('1 raycast and path views', h && Math.abs(h.dist - 1) < 1e-9 && h.seg.id === 0 && fin, `hit seg ${h && h.seg.id} at ${h && h.dist.toFixed(3)} m; ${nv} views, all columns hit a wall: ${fin}; ${SEGS.length} segments`);
}
// 2 and 3
{
  let ok2 = true, ok3 = true, info = '';
  for (const pol of ['off', 'greedy', 'spatial', 'angular']) {
    const P = PATHS.loop.poses(), st = createStream({ prefill: prefillFor('loop', 4), policy: pol });
    for (let i = 0; i < P.length; i += 3) {
      const R0 = st.pool.length, hist = st.history.slice(-st.Lmot);
      const ch = st.step(P.slice(i, i + 3));
      const ctx = [...ch.sink, ...ch.retrieved, ...ch.motion];
      if (ch.sink.length > st.Lsin || ch.sink.some(v => v.kind !== 'prefill')) ok2 = false;
      if (ch.motion.length !== hist.length || ch.motion.some((v, k) => v !== hist[k])) ok2 = false;
      if (new Set(ctx).size !== ctx.length) ok2 = false;
      if (ch.L !== ctx.length + ch.targets.length) ok2 = false;
      const Rn = R0 - ch.sink.length - ch.motion.length, budget = Math.min(st.s * ch.targets.length, Rn);
      const lim = pol === 'angular' ? budget + 4 : pol === 'off' ? 0 : budget;
      if (ch.retrieved.length > lim) ok3 = false;
    }
    info += `${pol}: ${st.chunks.length} chunks; `;
  }
  check('2 context bookkeeping', ok2, info);
  check('3 retrieval budget', ok3);
}
// 4
{
  const pose = { x: 13, y: 5.4, yaw: 0.3 };
  const a = createStream({ prefill: [], policy: 'off' }).step([pose]);
  const b = createStream({ prefill: [pose], policy: 'off' }).step([pose]);
  check('4 imagine without context, copy with it', a.recon === 0 && b.recon === 1, `recon ${a.recon} vs ${b.recon}`);
}
// 5
{
  const run = pol => { const P = PATHS.outback.poses(), st = createStream({ prefill: prefillFor('outback', 3), policy: pol }); for (let i = 0; i < P.length; i += 3) st.step(P.slice(i, i + 3)); return st.revisitMatch / st.revisitN; };
  const off = run('off'), on = run('angular');
  check('5 retrieval ablation in the toy', on > off + 0.4 && on > 0.75, `revisit consistency (gap > ${REVISIT_GAP} chunks): off ${(100 * off).toFixed(0)} %, spatial + angular ${(100 * on).toFixed(0)} %`);
}
// 6
{
  const shapes = D.T2.rows.every(r => r[2].length === D.T2.cols.length) && [D.T3, D.T4, D.T5, D.T6, D.T8].every(T => T.rows.every(r => r[1].length === T.cols.length));
  const src = fs.readFileSync(new URL('data.js', here), 'utf8'), html = fs.readFileSync(new URL('index.html', here), 'utf8');
  const text = html.replace(/<!--[\s\S]*?-->/g, '').replace(/data-tex="[^"]*"/g, '');
  const quoted = [...new Set([...text.matchAll(/\b\d+\.\d{2,3}\b/g)].map(m => m[0]))];
  const missing = quoted.filter(q => !src.includes(q));
  const col = (T, k) => T.rows.map(r => r[2][T.cols.findIndex(c => c[0] === k)]);
  const av = k => D.T2.rows.find(r => r[0] === 'AVM')[2][D.T2.cols.findIndex(c => c[0] === k)];
  const nn = a => a.filter(v => v != null);
  const claims = [
    ['AVM best FID', av('fid') === Math.min(...nn(col(D.T2, 'fid')))],
    ['AVM best VMAF', av('vmaf') === Math.max(...nn(col(D.T2, 'vmaf')))],
    ['GEN3C leads camera Ws', Math.max(...nn(col(D.T2, 'camWs'))) === 83.74],
    ['AVM lowest dynamic degree', av('deg') === Math.min(...nn(col(D.T2, 'deg')))],
    ['best world-model text 54.07', Math.max(...nn(col(D.T2, 'text'))) === 54.07],
    ['AVM best revisit PSNR', D.T5.rows.at(-1)[1][0] === Math.max(...D.T5.rows.map(r => r[1][0]))],
    ['LingBot leads revisit 3D Cons.', D.T5.rows[0][1][5] === 57.00 && D.T5.rows.at(-1)[1][5] === 53.13],
  ];
  const bad = claims.filter(c => !c[1]).map(c => c[0]);
  check('6 paper numbers and claims', shapes && !missing.length && !bad.length, `${quoted.length} quoted numbers, missing from data.js: [${missing.join(', ')}]; false claims: [${bad.join(', ')}]`);
}
// 7
{
  const els = new Map();
  const ctxStub = new Proxy({}, { get: (o, k) => k in o ? o[k] : () => {}, set: (o, k, v) => { o[k] = v; return true; } });
  const mk = id => {
    const e = { id, dataset: {}, style: {}, textContent: '', innerHTML: '', value: '3', clientWidth: 400, clientHeight: 200, width: 0, height: 0, _kids: [],
      classList: { toggle() {}, add() {}, remove() {} }, getContext: () => ctxStub, appendChild(c) { e._kids.push(c); return c; },
      querySelectorAll: () => e._kids, addEventListener() {} };
    return e;
  };
  const get = id => { if (!els.has(id)) els.set(id, mk(id)); return els.get(id); };
  const tables = ['T8', 'T6', 'T2', 'T3', 'T4', 'T5'].map(k => { const e = mk('t' + k); e.dataset.table = k; return e; });
  globalThis.window = globalThis; globalThis.devicePixelRatio = 1;
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#888' });
  globalThis.addEventListener = () => {}; globalThis.requestAnimationFrame = f => 0; globalThis.cancelAnimationFrame = () => {};
  globalThis.document = { getElementById: get, documentElement: mk('html'), querySelectorAll: q => q === '[data-table]' ? tables : [], createElement: t => mk(t) };
  let timer = null; globalThis.setInterval = f => { timer = f; return 1; }; globalThis.clearInterval = () => { timer = null; };
  let err = null, steps = 0;
  try {
    await import('./main.js');
    get('play').onclick();
    while (timer && steps < 500) { timer(); steps++; }
    for (const b of get('policies')._kids) { b.onclick(); get('stepBtn').onclick(); }
    for (const b of get('paths')._kids) { b.onclick(); get('stepBtn').onclick(); }
    window.snSaver.enter({ seed: 2 }); window.snSaver.exit();
  } catch (e) { err = e; }
  const built = tables.every(t => t.innerHTML.includes('<table'));
  check('7 main.js boots, builds tables, plays to the end', !err && built && steps > 10 && !timer, err ? String(err.stack).split('\n').slice(0, 3).join(' / ') : `${steps} chunks played, tables built: ${built}`);
}
console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
