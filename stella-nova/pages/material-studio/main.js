// ============================================================================
//  MATERIAL STUDIO  ·  main.js — boot and the page chrome (entry module)
// ────────────────────────────────────────────────────────────────────────────
//  Boot order: request the shared GPU device, import each module with its own
//  try/catch (a broken module shows a toast and the page keeps going), build
//  the node registry, call each module's init(ctx), then load the first graph
//  and emit graph:changed {reason:'boot'}. main.js also owns the chrome that
//  belongs to no module: toasts, side tabs, the splitter, undo/redo buttons,
//  the resolution select and the bake status.
//
//  SECTIONS  (grep -n the banner to jump)
//      chrome .......... toast, side tabs, splitter, undo/redo, res, status
//      modules ......... MODULES (init order) and loadModule
//      registry ........ buildRegistry / registerNodes
//      debug hook ...... window.__studio, selfTest, selfTestOk, selfTestNote
//      boot ............ the top-level await sequence
//
//  MODULE CONTRACT
//      A module exports `async function init(ctx)`. ctx holds:
//        store     store.js (state, on, emit, setters, undo)
//        gpu       gpu.js status object plus its functions
//        contract  contract.js namespace
//        $         id -> element
//        register(name, api)  put api on window.__studio[name]
//        registerNodes(defs)  add NodeDefs to state.registry later
//        modules   name -> imported module namespace (loaded so far)
//      A module that registers an api with selfTest() joins __studio.selfTest().
// ============================================================================
import * as contract from './contract.js';
import { store, state } from './store.js';
import { gpu, initGPU } from './gpu.js';

const $ = id => document.getElementById(id);
const modules = {};
const failed = [];

// ------------------------------------------------------------ chrome
const toastBox = $('toast');
function showToast({ message, kind = 'info', ms }) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = message;
  toastBox.appendChild(el);
  while (toastBox.children.length > 5) toastBox.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms || (kind === 'error' ? 7000 : 3200));
}
store.on('toast', showToast);

function setSide(tab) {
  document.body.dataset.side = tab;
  for (const b of $('side-tabs').querySelectorAll('button')) {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on); b.setAttribute('aria-selected', on);
  }
  state.ui.side = tab;
}
$('side-tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) setSide(b.dataset.tab); });
store.on('graph:select', ({ ids }) => { if (ids.length && document.body.dataset.side !== 'inspector') setSide('inspector'); });

// splitter: --vp-w is the viewport share of #work, in percent
const work = $('work');
const SPLIT_KEY = 'material-studio.split';
function setSplit(pct) {
  pct = Math.max(15, Math.min(85, pct));
  work.style.setProperty('--vp-w', pct + '%');
  state.ui.split = pct;
  window.dispatchEvent(new Event('resize'));
}
try { const v = parseFloat(localStorage.getItem(SPLIT_KEY)); if (v) setSplit(v); } catch (e) {}
{
  const split = $('split');
  let drag = null;
  split.addEventListener('pointerdown', e => { drag = work.getBoundingClientRect(); split.setPointerCapture(e.pointerId); document.body.classList.add('splitting'); });
  split.addEventListener('pointermove', e => { if (drag) setSplit(((e.clientX - drag.left) / drag.width) * 100); });
  const end = () => {
    if (!drag) return;
    drag = null; document.body.classList.remove('splitting');
    try { localStorage.setItem(SPLIT_KEY, String(state.ui.split)); } catch (e) {}
  };
  split.addEventListener('pointerup', end); split.addEventListener('pointercancel', end);
  split.addEventListener('dblclick', () => setSplit(45));
  split.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') setSplit((state.ui.split || 45) - 2);
    else if (e.key === 'ArrowRight') setSplit((state.ui.split || 45) + 2);
  });
}

// undo / redo
$('btn-undo').addEventListener('click', () => store.undo());
$('btn-redo').addEventListener('click', () => store.redo());
store.on('history:changed', ({ canUndo, canRedo }) => { $('btn-undo').disabled = !canUndo; $('btn-redo').disabled = !canRedo; });
window.addEventListener('keydown', e => {
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  const k = e.key.toLowerCase();
  if (!(e.ctrlKey || e.metaKey) || (k !== 'z' && k !== 'y')) return;
  e.preventDefault();
  if (k === 'y' || e.shiftKey) store.redo(); else store.undo();
});

// bake resolution
const resSel = $('res-select');
for (const r of contract.RES_OPTIONS) resSel.add(new Option(r + '', r + ''));
resSel.value = String(state.settings.res);
resSel.addEventListener('change', () => store.setRes(+resSel.value));
store.on('res:changed', ({ res }) => { resSel.value = String(res); });

// bake status
const status = $('bake-status');
store.on('bake:start', ({ res } = {}) => { status.textContent = `baking ${res || ''}`; status.dataset.kind = 'busy'; });
store.on('bake:done', maps => {
  state.maps = maps;
  status.textContent = maps && maps.ms != null ? `${maps.res}² · ${maps.ms.toFixed(0)} ms` : 'baked';
  status.dataset.kind = 'ok';
});
store.on('bake:error', ({ message } = {}) => { status.textContent = 'bake error'; status.title = message || ''; status.dataset.kind = 'error'; });

// ------------------------------------------------------------ modules
// Init order. Node modules come first so the registry exists before the
// graph and the compiler start. Helper modules (mesh, camera, zip, glb) are
// imported by their owners, not here.
const MODULES = [
  ['core', './nodes/core.js'],
  ['bench', './nodes/bench.js'],
  ['graph', './graph.js'],
  ['compile', './compile.js'],
  ['bake', './bake.js'],
  ['env', './env.js'],
  ['viewport', './viewport.js'],
  ['editor', './editor.js'],
  ['import', './import.js'],
  ['export', './export.js'],
  ['presets', './presets.js'],
  ['panels', './panels.js'],
  ['mobile', './mobile.js'],
];

async function loadModule(name, path) {
  try { modules[name] = await import(path); return modules[name]; }
  catch (e) {
    failed.push(name);
    console.error(`[boot] import ${path} failed`, e);
    store.toast(`Module "${name}" failed to load: ${e.message}`, 'error');
    return null;
  }
}

const INIT_TIMEOUT = 20000;
async function initModule(name, ctx) {
  const m = modules[name];
  if (!m || typeof m.init !== 'function') return;
  try {
    await Promise.race([
      m.init(ctx),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`init took more than ${INIT_TIMEOUT / 1000} s`)), INIT_TIMEOUT)),
    ]);
    store.emit('module:ready', { name });
  } catch (e) {
    failed.push(name);
    console.error(`[boot] ${name}.init failed`, e);
    store.toast(`Module "${name}" failed to start: ${e.message}`, 'error');
  }
}

// ------------------------------------------------------------ registry
/** Add NodeDefs to state.registry. A later def with the same type replaces the old one. */
function registerNodes(defs, source) {
  let n = 0;
  for (const d of defs || []) {
    if (!d || !d.type) continue;
    if (source && !d.source) d.source = source;
    state.registry.set(d.type, d);
    n++;
  }
  return n;
}

async function buildRegistry() {
  registerNodes(modules.core?.NODES, 'core');
  if (typeof modules.bench?.loadBenchNodes === 'function') {
    try { registerNodes(await modules.bench.loadBenchNodes(), 'bench'); }
    catch (e) { console.error('[boot] loadBenchNodes failed', e); store.toast('Bench nodes failed to load: ' + e.message, 'warn'); }
  }
}

// ------------------------------------------------------------ debug hook
const studio = {
  version: 1,
  store, state, gpu, contract, modules, failed,
  get registry() { return state.registry; },
  /**
   * Run the selfTest of each registered module, one at a time, and summarize.
   * @param {{only?:string[], skip?:string[]}} [opts]
   * @returns {Promise<{ok:boolean, ms:number, gpu:object, failed:string[], registry:number,
   *   gpuErrors:number, summary:Object<string,{ok:boolean, ms:number, note:string}>,
   *   results:Object<string,object>}>}  The result is also kept on __studio.lastSelfTest.
   */
  async selfTest(opts = {}) {
    const t0 = performance.now();
    const err0 = gpu.errors ? gpu.errors.count : 0;
    const out = {
      ok: true, ms: 0, gpu: { ok: gpu.ok, reason: gpu.reason }, failed: [...failed],
      registry: state.registry.size, gpuErrors: 0, summary: {}, results: {},
    };
    for (const [k, api] of Object.entries(studio)) {
      if (!api || typeof api !== 'object' || typeof api.selfTest !== 'function' || k === 'store') continue;
      if (opts.only && !opts.only.includes(k)) continue;
      if (opts.skip && opts.skip.includes(k)) continue;
      const t = performance.now();
      let r;
      try { r = await api.selfTest(); } catch (e) { r = { error: String(e && e.message || e) }; }
      out.results[k] = r;
      out.summary[k] = { ok: selfTestOk(r), ms: Math.round(performance.now() - t), note: selfTestNote(r) };
      if (!out.summary[k].ok) out.ok = false;
    }
    out.gpuErrors = (gpu.errors ? gpu.errors.count : 0) - err0;
    if (failed.length || !gpu.ok || out.gpuErrors) out.ok = false;
    out.ms = Math.round(performance.now() - t0);
    studio.lastSelfTest = out;
    return out;
  },
};
/** A module result passes when ok is true, or (without ok) when it has no error and no failures. */
function selfTestOk(r) {
  if (!r || typeof r !== 'object') return !!r;
  if (r.error) return false;
  if (typeof r.ok === 'boolean') return r.ok;
  if (typeof r.failed === 'number') return r.failed === 0;
  if (Array.isArray(r.failures)) return r.failures.length === 0;
  return true;
}
/** One short line for the summary: the error, or the first counters of the result. */
function selfTestNote(r) {
  if (!r || typeof r !== 'object') return String(r);
  if (r.error) return r.error;
  const bits = [];
  for (const [k, v] of Object.entries(r)) {
    if (k === 'ok') continue;
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') bits.push(`${k} ${v}`);
    if (bits.length >= 5) break;
  }
  return bits.join(', ');
}
window.__studio = studio;
function register(name, api) {
  if (['version', 'store', 'state', 'gpu', 'contract', 'modules', 'failed', 'registry', 'selfTest'].includes(name)) throw new Error('reserved __studio name ' + name);
  studio[name] = api;
}

// ------------------------------------------------------------ boot
await initGPU();
state.gpu = { ok: gpu.ok, reason: gpu.reason };
document.body.classList.toggle('no-gpu', !gpu.ok);

for (const [name, path] of MODULES) await loadModule(name, path);
await buildRegistry();

const ctx = { store, gpu, contract, $, register, registerNodes, modules };
for (const [name] of MODULES) await initModule(name, ctx);

// First graph: a module (presets or graph) may have set one during init.
if (!state.graph) {
  const g = contract.emptyGraph();
  try { state.graph = typeof modules.graph?.deserialize === 'function' ? modules.graph.deserialize(g) : g; }
  catch (e) { console.error('[boot] deserialize failed', e); state.graph = g; }
}
store.resetHistory();
store.emit('graph:changed', { reason: 'boot' });
store.emit('boot:done', { failed: [...failed] });
document.body.classList.add('booted');
studio.booted = true;
