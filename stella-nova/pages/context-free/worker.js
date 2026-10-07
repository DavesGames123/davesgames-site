// ============================================================================
//  CONTEXT FREE  ·  worker.js — one engine in a module worker
// ----------------------------------------------------------------------------
//  Our own code (GPL-2.0-or-later, see COPYING). One job at a time: the
//  engine runs synchronously, so a job that must stop early is stopped by
//  client.js, which terminates this worker. A time budget (budgetMs) asks
//  the engine itself to finish up and draw what it has.
//
//  IN   { type: 'init', module? }    a compiled WebAssembly.Module (fast
//                                     restart after a terminate)
//       { type: 'job', id, src, files, variation, defs, opts, svg }
//                                     opts.grow keeps the renderer for:
//       { type: 'growFrame', id, mode, at, mask }   one replay frame
//       { type: 'growEnd' }
//  OUT  { id, type: 'parsed', ok, diags, messages, info }
//       { id, type: 'progress', shapes, todo, inOutput, done, count }
//       { id, type: 'frame', w, h, index, buf }        buf is transferred
//       { id, type: 'done', ok, ..., buf? | svg? }
//       { id, type: 'growFrame', bitmap, w, h, at }     bitmap is transferred
//       { type: 'fatal', error }                       the engine failed to load
// ============================================================================
import { loadEngine } from './engine.js';
import { toMask } from './look.js';

let ready = null;

function start(module) {
  const init = module ? {
    instantiateWasm(imports, receive) {
      WebAssembly.instantiate(module, imports).then(inst => receive(inst, module));
      return {};
    },
  } : { locateFile: f => new URL('./' + f, import.meta.url).href };
  ready = loadEngine(init);
  ready.catch(err => postMessage({ type: 'fatal', error: String(err && err.message || err) }));
}

function job(E, m) {
  const { id, opts = {} } = m;
  const t0 = performance.now();
  let p = E.parse(m.src, m.variation | 0 || 1, m.files || {}, m.defs || ''), defsIgnored = false;
  // A define makes the engine read the design as CFDG 3 only (as -D does
  // in the CLI). A CFDG 2 design then fails: render it without the define.
  if (!p.ok && m.defs) {
    const q = E.parse(m.src, m.variation | 0 || 1, m.files || {}, '');
    if (q.ok) { p = q; defsIgnored = true; }
  }
  postMessage({ id, type: 'parsed', ok: p.ok, diags: p.diags, messages: p.messages, info: p.info, defsIgnored });
  if (!p.ok) { postMessage({ id, type: 'done', ok: false, diags: p.diags, messages: p.messages }); return; }
  if (opts.parseOnly) { postMessage({ id, type: 'done', ok: true, info: p.info, parseOnly: true }); return; }
  if (m.svg) {
    const svg = E.svg(opts);
    postMessage({ id, type: 'done', ok: !!svg, svg, ms: performance.now() - t0 });
    return;
  }
  let lastPost = 0;
  const budget = opts.budgetMs || 0;
  const res = E.render(opts, {
    onProgress(q) {
      const now = performance.now();
      if (now - lastPost > 90) { lastPost = now; postMessage(Object.assign({ id, type: 'progress' }, q)); }
      if (budget && now - t0 > budget) return 'finish';
      return 0;
    },
    onFrame(px, w, h, index) {
      postMessage({ id, type: 'frame', w, h, index, buf: px.buffer }, [px.buffer]);
    },
  });
  if (res.grow) { growInfo = res.info; growDims = { w: res.width, h: res.height }; }
  const out = Object.assign({ id, type: 'done', ms: performance.now() - t0, defsIgnored }, res);
  const buf = res.pixels ? res.pixels.buffer : null;
  delete out.pixels;
  if (buf) { out.buf = buf; postMessage(out, [buf]); } else postMessage(out);
}

let growInfo = null, growDims = null;

async function growFrame(E, m) {
  const px = E.growFrame(m.mode, m.at);
  if (!px) { postMessage({ id: m.id, type: 'growFrame', bitmap: null }); return; }
  if (m.mask) toMask(px, growInfo);
  const bitmap = await createImageBitmap(new ImageData(px, growDims.w, growDims.h));
  postMessage({ id: m.id, type: 'growFrame', bitmap, w: growDims.w, h: growDims.h, at: m.at }, [bitmap]);
}

onmessage = async e => {
  const m = e.data;
  if (m.type === 'init') { start(m.module); return; }
  if (m.type === 'growFrame' || m.type === 'growEnd') {
    let E2;
    try { E2 = await ready; } catch (err) { return; }
    if (m.type === 'growEnd') { E2.growEnd(); growInfo = growDims = null; return; }
    try { await growFrame(E2, m); } catch (err) { postMessage({ id: m.id, type: 'growFrame', bitmap: null, error: String(err) }); }
    return;
  }
  if (m.type !== 'job') return;
  if (!ready) start(null);
  let E;
  try { E = await ready; } catch (err) { postMessage({ id: m.id, type: 'done', ok: false, error: String(err) }); return; }
  try { job(E, m); } catch (err) {
    postMessage({ id: m.id, type: 'done', ok: false, error: String(err && err.message || err) });
  }
};
