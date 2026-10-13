// ============================================================================
//  BREADBOARD LAB  ·  main.js — the glue between store, view, sim and panels
// ----------------------------------------------------------------------------
//  CONTRACT 4.5. One store holds the bench document. The view (view/scene.js)
//  draws it and turns gestures into store ops. The simulator (sim/client.js,
//  a module worker with an inline fallback) runs the netlist that
//  sim/netlist.js builds from the document. The UI (ui/app.js) fills the
//  panels. This file starts them and routes the changes between them.
//
//  DOCUMENT CHANGES (bus 'doc:change'):
//    load ........................ new netlist, fresh engine (carry off),
//                                  camera to the saved view or a fit
//    topology .................... new netlist, engine state carried over
//    params.<key> on a part ...... live param: sim.setParam; other params:
//                                  sim.patch with the part's new elements
//                                  (a rebuild when the element ids change)
//    settings.* on a probe ....... sim.setProbe with the new settings
//    program ..................... sim.loadProgram
//  Rebuilds coalesce: a burst of edits makes one sim.load.
//
//  SIM TRAFFIC: frames go to view.setFrame, ui.setFrame and the bus
//  ('sim:frame'); events to the bus ('sim:event': the UI makes the toasts,
//  CHECKS rows and sounds) and to view.effect('smoke') for smoke events;
//  serial text and run state to the bus.
//
//  GPU RELEASE: pagehide disposes the view (forceContextLoss), the sim
//  worker and the audio. A page restored from the back-forward cache
//  reloads, because its GPU context is gone.
//
//  START ORDER: share link (#d=...), else the autosave, else the first
//  example. Pass ?example=<key> to open an example directly.
//
//  GREP MAP
//    initialDoc .......... share link, autosave, first example
//    makeView / stubView . the 3D view, or a no-op view without WebGL
//    rebuild ............. netlist -> sim.load -> view/ui netlists
//    onDocChange ......... the routing of document edits
//    flatOps / partDef ... op helpers
//    wireSim ............. sim events -> view, ui, bus
//    pagehide ............ GPU release
//    window.snSaver ...... saver.js (installSaver)
// ============================================================================
import * as THREE from 'three';
import { createRegistry } from './parts/index.js';
import * as geo from './parts/geometry.js';
import * as materials from './parts/materials.js';
import { createBus } from './core/bus.js';
import { createStore } from './core/store.js';
import { normalizeDoc, starterDoc } from './core/doc.js';
import { createView } from './view/scene.js';
import { buildNetlist } from './sim/netlist.js';
import { createSim } from './sim/client.js';
import { createUI } from './ui/app.js';
import { compileSketch } from './mcu/compile.js';
import { BOARDS } from './mcu/boards.js';
import { decodeHash } from './ui/share.js';
import { createFiles } from './ui/files.js';
import { EXAMPLES, list as exampleList, loadExample } from './examples/index.js';
import { installSaver } from './saver.js';

const $ = id => document.getElementById(id);
const registry = createRegistry();
const bus = createBus();
let saverOn = false;           // the screensaver owns the camera

// ── the first document ─────────────────────────────────────────────────────
async function initialDoc() {
  const norm = (raw, from) => {
    const { doc, warnings } = normalizeDoc(raw, { registry, validateMaterial: materials.validateMaterial });
    if (warnings.length) console.info(`breadboard-lab: ${from} loaded with ${warnings.length} repairs`, warnings);
    return doc;
  };
  let q = null;
  try { q = new URLSearchParams(location.search).get('example'); } catch (e) { q = null; }
  if (q && EXAMPLES.some(e => e.key === q)) {
    try { return { doc: norm((await loadExample(q)).doc, 'example'), from: 'example' }; } catch (e) { /* fall through */ }
  }
  try {
    const raw = await decodeHash(location.hash);
    if (raw) return { doc: norm(raw, 'share link'), from: 'link' };
  } catch (e) { console.warn('breadboard-lab: the share link could not be read', e); }
  try {
    const raw = createFiles().loadAutosave();
    if (raw && Array.isArray(raw.parts) && raw.parts.length) return { doc: norm(raw, 'autosave'), from: 'autosave' };
  } catch (e) { /* storage blocked */ }
  try { return { doc: norm((await loadExample(EXAMPLES[0].key)).doc, 'example'), from: 'example' }; }
  catch (e) { return { doc: starterDoc(), from: 'empty' }; }
}

const start = await initialDoc();
const store = createStore(start.doc, bus, { registry });

// ── view (or a no-op view when WebGL is missing) ───────────────────────────
function stubView() {
  const noop = () => null;
  return new Proxy({ canvas: $('gl'), ready: Promise.resolve(null), stub: true }, {
    get(t, k) { return k in t ? t[k] : noop; },
  });
}
function makeView() {
  try {
    const v = createView({ canvas: $('gl'), store, registry, bus, THREE, materials });
    return v;
  } catch (e) {
    console.warn('breadboard-lab: no 3D view', e);
    return null;
  }
}
const realView = makeView();
const view = realView || stubView();

// ── simulator ──────────────────────────────────────────────────────────────
const sim = createSim();
const ui = createUI({ store, registry, bus, view, sim, mcu: { compileSketch, BOARDS }, materials });
if (!realView) ui.showNoGL();
ui.examples(exampleList());

let netlist = null;
let loading = false, again = null;
const pwmOf = () => (store.doc.sim && store.doc.sim.pwm) || 'auto';

function build() {
  try { return buildNetlist(store.doc, registry, geo); }
  catch (e) { console.error('breadboard-lab: netlist build failed', e); ui.toast('error', 'The circuit could not be read: ' + e.message); return null; }
}

// carry: keep the engine state (a wire change keeps running)
async function rebuild(carry) {
  if (loading) { again = again === null ? carry : again && carry; return; }
  loading = true;
  try {
    const nl = build();
    if (nl) {
      netlist = nl;
      view.setNetlist(nl);
      ui.setNetlist(nl);
      const r = await sim.load(nl, { carry, opts: { pwm: pwmOf() } });
      if (r && !r.ok) ui.toast('warn', 'The circuit did not settle at the start: ' + ((r.warnings || [])[0] || 'no DC solution'));
      for (const p of Object.values((r && r.programs) || {})) {
        if (p && p.ok === false && p.errors && p.errors.length) ui.toast('warn', `Sketch: line ${p.errors[0].line}: ${p.errors[0].msg}`);
      }
    }
  } finally {
    loading = false;
    if (again !== null) { const c = again; again = null; rebuild(c); }
  }
}

// ── document edits ─────────────────────────────────────────────────────────
function flatOps(ops, out = []) {
  for (const op of ops || []) { if (op && op.op === 'batch') flatOps(op.ops, out); else if (op) out.push(op); }
  return out;
}
function partDef(id) {
  const p = (store.doc.parts || []).find(x => x.id === id);
  if (!p) return null;
  let d = null;
  try { d = registry.get(p.def); } catch (e) { d = null; }
  return d || (store.doc.customParts || []).find(c => c.id === p.def) || null;
}
let camDone = false;
function onDocChange({ ops, topology, source } = {}) {
  if (source === 'load') {
    rebuild(false);
    if (saverOn) return;
    const d = store.doc;
    if (d.view && d.view.pos) view.cameraTo(d.view, camDone ? 600 : 0);
    else if (camDone) Promise.resolve(view.ready).then(() => view.fit());
    camDone = true;
    return;
  }
  if (topology) { rebuild(true); return; }
  let patchNl = null;
  const nlNow = () => (patchNl || (patchNl = build()));
  for (const op of flatOps(ops)) {
    if (op.op === 'program') { sim.loadProgram(op.id, op.program || null).then(r => { if (r && r.ok === false && r.errors && r.errors[0]) ui.toast('warn', `Sketch: line ${r.errors[0].line}: ${r.errors[0].msg}`); }); continue; }
    if (op.op === 'meta' && op.sim && op.sim.pwm) { rebuild(true); return; }
    if (op.op !== 'set' || typeof op.path !== 'string') continue;
    const [head, key] = op.path.split('.');
    const probe = (store.doc.probes || []).find(p => p.id === op.id);
    if (probe && head === 'settings') {
      const nl = nlNow();
      const np = nl && nl.probes.find(p => p.id === op.id);
      if (np) sim.setProbe(np);
      continue;
    }
    const def = partDef(op.id);
    if (!def || head !== 'params' || !key) continue;
    const pd = (def.params || []).find(p => p.key === key);
    if (pd && pd.live) { sim.setParam(op.id, key, op.value); continue; }
    const nl = nlNow();
    if (!nl) continue;
    const els = nl.elements.filter(e => e.owner === op.id);
    // a param that picks other templates (seg7 common) changes the element
    // ids: patch cannot do that, a rebuild can
    const ids = list => list.filter(e => e.owner === op.id).map(e => e.id).join();
    if (!netlist || ids(netlist.elements) !== ids(els)) { rebuild(true); return; }
    sim.patch(op.id, els);
  }
  if (patchNl) { netlist = patchNl; view.setNetlist(patchNl); ui.setNetlist(patchNl); }
}
bus.on('doc:change', onDocChange);

// ── sim traffic ────────────────────────────────────────────────────────────
let errShown = false;
function wireSim() {
  sim.on('frame', f => { view.setFrame(f); ui.setFrame(f); bus.emit('sim:frame', f); });
  sim.on('event', e => {
    bus.emit('sim:event', e);
    if (e && e.smoke && e.owner) view.effect('smoke', e.owner);
    else if (e && e.kind === 'fuse' && e.owner) view.effect('spark', e.owner);
  });
  sim.on('serial', s => bus.emit('sim:serial', s));
  sim.on('state', s => bus.emit('sim:state', s));
  sim.on('error', msg => {
    console.warn('breadboard-lab sim:', msg);
    if (!errShown) { errShown = true; ui.toast('warn', String(msg)); }
  });
}
wireSim();

// ── GPU release ────────────────────────────────────────────────────────────
let gone = false;
function release() {
  if (gone) return;
  gone = true;
  try { saver.exit(); } catch (e) { /* not running */ }
  try { ui.dispose(); } catch (e) { /* already gone */ }
  try { sim.dispose(); } catch (e) { /* already gone */ }
  try { if (realView) realView.dispose(); } catch (e) { /* already gone */ }
}
window.addEventListener('pagehide', release);
window.addEventListener('pageshow', e => { if (e.persisted && gone) location.reload(); });

// ── screensaver ────────────────────────────────────────────────────────────
const saver = installSaver({
  store, view, realView, sim, bus, registry, geo, normalizeDoc, loadExample,
  setSaverOn: v => { saverOn = !!v; },
});
window.snSaver = saver;

// ── first load ─────────────────────────────────────────────────────────────
await rebuild(false);
camDone = true;
if (start.from === 'example' || start.from === 'link') Promise.resolve(view.ready).then(() => { if (!store.doc.view && !saverOn) view.fit(0); });
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!reduced && !saverOn) sim.start();


// for the console
window.bblab = { store, view, sim, ui, bus, registry, get netlist() { return netlist; } };
