// ============================================================================
//  BREADBOARD LAB  ·  ui/dom-tests.mjs — createUI on the fake DOM
// ----------------------------------------------------------------------------
//  Called by ui/tests.mjs. Builds the page ids of CONTRACT 4.4, makes the UI
//  with the real store, bus and part registry when they are present (stubs
//  otherwise), a recording view and sim, then clicks and types through it:
//  panels, instruments, frames, selection, keys, undo, leads, code upload,
//  serial text, materials, the part editor, and the phone layout.
//
//  GREP MAP
//    makeHost .......... the DOM ids and the collaborators
//    domTests .......... the checks
// ============================================================================
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom, mkEvent } from './fakedom.mjs';

const settle = (ms = 5) => new Promise(r => setTimeout(r, ms));

async function collaborators(ROOT) {
  let createBus = null, createStore = null, registry = null, materials = null;
  try { ({ createBus } = await import(pathToFileURL(join(ROOT, 'core', 'bus.js')).href)); } catch (e) { createBus = null; }
  try { ({ createStore } = await import(pathToFileURL(join(ROOT, 'core', 'store.js')).href)); } catch (e) { createStore = null; }
  try {
    const R = await import(pathToFileURL(join(ROOT, 'parts', 'registry.js')).href);
    const defs = [];
    for (const f of readdirSync(join(ROOT, 'parts', 'defs')).filter(f => f.endsWith('.js'))) {
      const m = await import(pathToFileURL(join(ROOT, 'parts', 'defs', f)).href);
      for (const v of Object.values(m)) if (Array.isArray(v) && v.length && v[0] && v[0].id && v[0].pins) defs.push(...v);
    }
    registry = R.createRegistry(defs);
  } catch (e) { registry = null; }
  try { materials = await import(pathToFileURL(join(ROOT, 'parts', 'materials.js')).href); } catch (e) { materials = null; }
  if (!createBus) createBus = () => { const L = new Map(); return { on(t, f) { if (!L.has(t)) L.set(t, []); L.get(t).push(f); return () => L.set(t, L.get(t).filter(x => x !== f)); }, once() {}, emit(t, p) { for (const f of (L.get(t) || []).slice()) f(p); } }; };
  return { createBus, createStore, registry, materials };
}

function sampleDoc() {
  return {
    format: 'breadboard-lab', version: 1, title: 'UI test bench', notes: '',
    boards: [{ id: 'b1', type: 'bb830', x: 0, z: 0, rot: 0 }],
    parts: [
      { id: 'p2', def: 'res', place: { on: 'b1', x: -20.32, z: -6.35, rot: 0 }, params: { r: 220 } },
      { id: 'p3', def: 'led', place: { on: 'b1', x: -7.62, z: -6.35, rot: 0 }, params: { color: 'red' } },
      { id: 'p4', def: 'supply-bench', place: { on: null, x: -120, z: 60, rot: 0 }, params: { v: 5, ilim: 0.5, on: true } },
      { id: 'p5', def: 'funcgen', place: { on: null, x: -60, z: 60, rot: 0 }, params: {} },
      { id: 'p6', def: 'mcu-uno', place: { on: null, x: 120, z: 70, rot: 0 }, params: {} }
    ],
    wires: [{ id: 'w7', a: { part: 'p4', pin: '+' }, b: { hole: 'b1:TP3' }, color: '#d63b3b', style: 'arch' }],
    probes: [
      { id: 'm8', type: 'dmm', place: { x: 60, z: 60, rot: 0 }, leads: { red: null, black: null }, settings: { mode: 'A', range: 'auto' } },
      { id: 'm9', type: 'scope', place: { x: 0, z: 90, rot: 0 }, leads: { ch1: null, ch2: null, gnd: null }, settings: { tdiv: 1e-3, vdiv: [1, 1], offset: [0, 0], trig: { ch: 0, level: 2.5, edge: 'rise', mode: 'auto' } } },
      { id: 'm10', type: 'logic', place: { x: 90, z: 90, rot: 0 }, leads: { d0: null, d1: null, gnd: null }, settings: { threshold: 1.5 } }
    ],
    materials: [], customParts: [], programs: {}, sim: { speed: 1, pwm: 'auto' }, nextId: 11
  };
}

function makeHost(doc) {
  const body = doc.body;
  const stage = doc.createElement('div'); stage.id = 'stage';
  const gl = doc.createElement('canvas'); gl.id = 'gl'; stage.appendChild(gl);
  body.appendChild(stage);
  for (const id of ['bar', 'leftCol', 'rightCol', 'instrDock', 'status', 'toasts', 'dock', 'sheet', 'nogl', 'tip']) { const e = doc.createElement('div'); e.id = id; body.appendChild(e); }
  return gl;
}
function recorder(name, extra = {}) {
  const calls = [];
  const obj = new Proxy({ calls, ...extra }, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k !== 'string') return undefined;
      return (...a) => { calls.push([k, ...a]); return undefined; };
    }
  });
  return obj;
}

export async function domTests({ ok, ROOT }) {
  const dom = installDom();
  const gl = makeHost(dom);
  const { createBus, createStore, registry, materials } = await collaborators(ROOT);
  ok(true, 'collaborators', `bus ${createBus ? 'real' : 'stub'}, store ${createStore ? 'real' : 'stub'}, registry ${registry ? registry.list().length + ' defs' : 'none'}, materials ${materials ? materials.MATERIAL_PRESETS.length + ' presets' : 'none'}`);
  if (!createStore || !registry) { ok(false, 'the DOM tests need core/store.js and the part registry'); return; }
  const bus = createBus();
  const store = createStore(sampleDoc(), bus);
  let pickT = null;
  const view = recorder('view', { canvas: gl, pick: () => pickT, screens: () => ({ screen: gl.getContext('2d') }) });
  const sim = recorder('sim');
  const { compileSketch } = await import('../mcu/compile.js');
  const { BOARDS } = await import('../mcu/boards.js');
  const { createUI } = await import('./app.js');
  let ui, err = null;
  try { ui = createUI({ store, registry, bus, view, sim, mcu: { compileSketch, BOARDS }, materials }); } catch (e) { err = e; }
  ok(!err && ui, 'createUI builds on the fake DOM', err ? err.stack.split('\n').slice(0, 3).join(' | ') : 'ok');
  if (!ui) return;
  await settle();
  const $ = id => dom.getElementById(id);
  ok($('bar').querySelectorAll('button').length >= 20 && $('status').children.length >= 4, 'the bar and the status bar are filled', `${$('bar').querySelectorAll('button').length} bar buttons, ${$('status').children.length} status items`);
  ok(!$('p-library').hidden && $('leftCol').contains($('p-library')), 'LIBRARY is open in the left column');
  ok($('p-library').querySelectorAll('.card').length > 40, 'the library lists boards, instruments and parts', `${$('p-library').querySelectorAll('.card').length} cards`);
  const cards = $('instrDock').querySelectorAll('.instr-card');
  ok(cards.length === 5, 'one instrument card per DMM, scope, logic, supply and generator', `${cards.length} cards`);

  // a frame
  const frame = {
    t: 0.5, speed: 1, ratio: 1, running: true, nodeV: new Float32Array([0, 5, 3.0, 1.8]), wires: new Float32Array([0.0136]),
    parts: { p3: { i: 0.0136, p: 0.024, vis: { b: 0.68 } }, p4: { vis: { v: 5, a: 0.0136, cc: false, on: true } }, p2: { i: 0.0136, p: 0.04 } },
    probes: {
      m8: { kind: 'dmm', value: 0.0136, unit: 'A', overload: false, fuse: 'ok', beep: false },
      m9: { kind: 'scope', t0: 0, dt: 1e-5, ch: [Float32Array.from({ length: 500 }, (_, i) => 2.5 + 2.5 * Math.sin(2 * Math.PI * 1000 * i * 1e-5)), new Float32Array(500).fill(1)] },
      m10: { kind: 'logic', t0: 0.5, edges: [[0.1, 0, 1], [0.2, 0, 0]], levels: 0 }
    },
    mcus: {}, stats: { steps: 10, rejected: 0, newton: 20, solveMs: 1, nodes: 4 }
  };
  let fErr = null;
  try { ui.setFrame(frame); ui.setNetlist({ nodeCount: 4, nodeNames: ['gnd', 'b1:TP', 'b1:3T', 'b1:8T'], issues: [{ level: 'warn', code: 'led-no-resistor', msg: 'LED p3 has no series resistor', targets: [{ kind: 'part', id: 'p3' }] }], holeNode: { 'b1:TP3': 1 }, pinNode: { 'p3.A': 2, 'p3.K': 3 }, wireIds: ['w7'], mcus: [], probes: [], elements: [] }); } catch (e) { fErr = e; }
  ok(!fErr, 'setFrame and setNetlist run', fErr ? fErr.stack.split('\n').slice(0, 2).join(' | ') : '');
  const dmm = ui.instrument('m8');
  ok(dmm && dmm.reading && `${dmm.reading.reading.text} ${dmm.reading.reading.unit}` === '13.60 mA', 'the DMM card shows 13.60 mA from the frame', dmm && dmm.reading ? `${dmm.reading.reading.text} ${dmm.reading.reading.unit}` : 'none');
  const sc = ui.instrument('m9');
  ok(sc && sc.measurements.length && Math.abs(sc.measurements[0].pp - 5) < 0.01, 'the scope card measures the 5 Vpp sine', sc && sc.measurements[0] ? sc.measurements[0].pp.toFixed(3) + ' Vpp' : 'none');
  ok(/1/.test($('status').querySelector('.issues-n').textContent), 'the status bar counts the netlist issue', $('status').querySelector('.issues-n').textContent);
  ok($('instrDock').querySelector('.instr.supply') !== null, 'the supply card is there');

  // selection opens INSPECT with the resistor's value well
  bus.emit('select', { ids: ['p2'] });
  await settle();
  const insp = $('p-inspect');
  ok(insp && !insp.hidden && /220/.test(insp.querySelector('.num') ? insp.querySelector('.num').textContent : ''), 'selecting the resistor opens INSPECT with a 220 Ω well', insp.querySelector('.num') ? insp.querySelector('.num').textContent : 'no well');
  ui.setFrame(frame);
  const kv = insp.querySelector('.kv');
  ok(kv && /13\.6 mA/.test(kv.textContent), 'INSPECT shows the live current of the resistor', kv ? kv.textContent.slice(0, 40) : 'no live block');

  // keys: tool, rotate, undo
  const key = (k, mods = {}) => dom.dispatchEvent(mkEvent('keydown', { key: k, target: dom.body, ...mods }));
  key('w');
  ok(view.calls.some(c => c[0] === 'setTool' && c[1] === 'wire'), 'W sets the wire tool on the view');
  key('r');
  const rot = store.doc.parts.find(p => p.id === 'p2').place.rot;
  ok(rot === 1, 'R rotates the selected part (a store op)', `rot ${rot}`);
  key('z', { metaKey: true });
  ok(store.doc.parts.find(p => p.id === 'p2').place.rot === 0, 'Cmd+Z undoes it');
  key('3');
  ok(view.calls.some(c => c[0] === 'setWireColor' && c[1] === '#2f80d6'), 'key 3 picks the blue wire');
  key(' ');
  ok(sim.calls.some(c => c[0] === 'start' || c[0] === 'pause'), 'Space runs or pauses the sim', sim.calls.filter(c => c[0] === 'start' || c[0] === 'pause').map(c => c[0]).join(','));

  // library: a tap arms placing
  const ledCard = [...$('p-library').querySelectorAll('.card')].find(c => c.dataset.k === 'part:led');
  ledCard.dispatchEvent(mkEvent('pointerdown', { button: 0, clientX: 10, clientY: 10, pointerId: 1 }));
  ledCard.dispatchEvent(mkEvent('pointerup', { clientX: 10, clientY: 10 }));
  ok(view.calls.some(c => c[0] === 'beginPlace' && c[1] === 'led'), 'tapping a library card calls view.beginPlace(defId)');
  const nb = store.doc.boards.length;
  const boardCard = [...$('p-library').querySelectorAll('.card')].find(c => c.dataset.k === 'board:bb400');
  boardCard.dispatchEvent(mkEvent('pointerdown', { button: 0, clientX: 10, clientY: 10, pointerId: 1 }));
  boardCard.dispatchEvent(mkEvent('pointerup', { clientX: 10, clientY: 10 }));
  const added = store.doc.boards[store.doc.boards.length - 1];
  ok(store.doc.boards.length === nb + 1 && added.type === 'bb400' && added.x > 82.55 + 41, 'the half-board card adds a bb400 right of the 830', `${added.id} at x ${added.x}`);

  // leads: press RED on the DMM, click a hole
  const redBtn = [...$('instrDock').querySelectorAll('.lead')].find(b => /RED/.test(b.textContent));
  redBtn.click();
  pickT = { kind: 'hole', hole: 'b1:a5' };
  gl.dispatchEvent(mkEvent('pointerdown', { clientX: 50, clientY: 50, pointerId: 2, pointerType: 'mouse' }));
  gl.dispatchEvent(mkEvent('pointerup', { clientX: 50, clientY: 50, pointerId: 2 }));
  const lead = store.doc.probes.find(p => p.id === 'm8').leads.red;
  ok(lead && lead.hole === 'b1:a5', 'a lead button, then a click on a hole, plugs the DMM red lead', JSON.stringify(lead));

  // code: upload a sketch to the Uno-layout board
  const uiCode = $('p-code');
  const codeTab = [...$('bar').querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Code');
  codeTab.click();
  await settle();
  ok(!uiCode.hidden, 'the CODE tab opens the editor');
  const ta = uiCode.querySelector('textarea');
  ta.value = 'void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, HIGH); delay(200); digitalWrite(13, LOW); delay(200); }\n';
  ta.dispatchEvent(mkEvent('input'));
  const up = [...uiCode.querySelectorAll('button')].find(b => b.textContent === 'Upload');
  up.click();
  const prog = store.doc.programs.p6;
  ok(prog && prog.lang === 'sketch' && /delay\(200\)/.test(prog.source), 'UPLOAD stores the sketch as the program of the board', prog ? prog.source.length + ' chars' : 'none');
  ta.value = 'void setup() {\n  int x = ;\n}\nvoid loop() {}\n';
  ta.dispatchEvent(mkEvent('input'));
  [...uiCode.querySelectorAll('button')].find(b => b.textContent === 'Verify').click();
  ok(/line 2/.test(uiCode.querySelector('.errs').textContent), 'VERIFY lists the error with its line', uiCode.querySelector('.errs').textContent.slice(0, 60));
  bus.emit('sim:serial', { mcu: 'p6', text: 'hello from the sketch\r\n' });
  await settle(20);
  ok(/hello from the sketch/.test(uiCode.querySelector('.serial-out').textContent), 'sim:serial text shows in the monitor');

  // a damage event: toast and a CHECKS row
  bus.emit('sim:event', { t: 0.6, kind: 'damage', owner: 'p3', severity: 'error', msg: 'LED p3 burned out: 120 mA, its limit is 50 mA', smoke: true });
  ok($('toasts').children.length >= 1 && /burned out/.test($('toasts').textContent), 'a damage event makes a toast', $('toasts').textContent.slice(0, 50));
  ok(/burned out/.test($('p-checks').textContent), 'and a row in CHECKS');

  // materials: duplicate a preset into the document
  const matTab = [...$('bar').querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Materials');
  matTab.click();
  await settle();
  const firstMat = $('p-materials').querySelector('.mat');
  firstMat.click();
  const dup = [...$('p-materials').querySelectorAll('button')].find(b => b.textContent === 'Duplicate');
  const n0 = store.doc.materials.length;
  dup.click();
  ok(store.doc.materials.length === n0 + 1 && /^mat-/.test(store.doc.materials[n0].id), 'DUPLICATE puts an editable material in the document', store.doc.materials[n0] ? store.doc.materials[n0].id : 'none');

  // part editor: a new part saves into the document and the registry
  const peTab = [...$('bar').querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Part editor');
  peTab.click();
  await settle();
  [...$('p-parts').querySelectorAll('button')].find(b => b.textContent === 'New part').click();
  [...$('p-parts').querySelectorAll('button')].find(b => b.textContent === 'Save').click();
  const cp = store.doc.customParts[0];
  const errs = $('p-parts').querySelector('.errs');
  ok(cp && /^cp-/.test(cp.id) && registry.get(cp.id), 'a new custom part saves into the document and the registry', cp ? cp.id : (errs ? errs.textContent.slice(0, 160) : 'not saved'));

  // file: the share link
  const fileTab = [...$('bar').querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'File, save, share');
  fileTab.click();
  await settle();
  [...$('p-file').querySelectorAll('button')].find(b => b.textContent === 'Make link').click();
  await settle(30);
  const link = $('p-file').querySelector('input[readonly]');
  ok(link && /#d=/.test(link.value), 'MAKE LINK writes a #d= share link', link ? link.value.slice(0, 60) + '…' : 'none');
  ui.examples([{ meta: { key: 'first-led', title: 'First LED', level: 1, blurb: 'A red LED on 5 V', see: ['LED glows'] }, doc: sampleDoc() }]);
  ok(/First LED/.test($('p-examples').textContent), 'ui.examples(list) fills EXAMPLES');
  let dErr = null;
  try { ui.dispose(); } catch (e) { dErr = e; }
  ok(!dErr, 'ui.dispose() runs');

  // the phone layout
  const dom2 = installDom({ phone: true, width: 390, height: 800 });
  const gl2 = makeHost(dom2);
  const bus2 = createBus();
  const store2 = createStore(sampleDoc(), bus2);
  const view2 = recorder('view', { canvas: gl2, pick: () => null, screens: () => null });
  let ui2, e2 = null;
  try { ui2 = createUI({ store: store2, registry, bus: bus2, view: view2, sim: recorder('sim'), mcu: { compileSketch, BOARDS }, materials }); } catch (e) { e2 = e; }
  await settle();
  ok(!e2 && dom2.body.classList.contains('phone') && dom2.getElementById('dock').querySelectorAll('button').length === 5, 'phone: body.phone and five dock buttons', e2 ? e2.message : '');
  const libBtn = dom2.getElementById('dock').querySelector('button');
  libBtn.click();
  await settle();
  const sheet = dom2.getElementById('sheet');
  ok(sheet.classList.contains('open') && sheet.querySelector('.sheet-body').contains(dom2.getElementById('p-library')) && !dom2.getElementById('p-library').hidden, 'phone: LIB opens the sheet with the library in it');
  const instrBtn = [...dom2.getElementById('dock').querySelectorAll('button')].find(b => b.dataset.k === 'instr');
  instrBtn.click();
  await settle();
  ok(sheet.querySelectorAll('.instr-card').length === 5 && dom2.getElementById('p-library').hidden, 'phone: INSTR shows the instrument cards in the sheet', `${sheet.querySelectorAll('.instr-card').length} cards`);
  if (ui2) ui2.dispose();
}
