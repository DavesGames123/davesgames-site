// ============================================================================
//  BREADBOARD LAB  ·  ui/app.js — createUI: the whole page around the 3D view
// ----------------------------------------------------------------------------
//  createUI({ store, registry, bus, view, sim, mcu, materials }) -> ui
//  (CONTRACT 4.4). It fills the DOM ids that index.html provides (#stage,
//  #bar, #leftCol, #rightCol, #instrDock, #status, #toasts, #dock, #sheet,
//  #nogl, #tip); a missing one is made and appended to <body>.
//
//    #bar ........ panel tabs, tools (V W P X), wire colours and style,
//                  run / pause / step / speed / reset, undo / redo, views
//    #leftCol .... LIBRARY
//    #rightCol ... INSPECT, CHECKS, EXAMPLES, MATERIALS, PARTS, CODE, FILE
//                  (two at most; a third closes the oldest)
//    #instrDock .. one squircle per instrument: DMM, scope, logic analyzer,
//                  bench supply, function generator
//    #status ..... sim time, real-time ratio, the voltage under the pointer,
//                  the issue count, a hint line
//    phone ....... #dock and #sheet (ui/dock.js); panels become sheet tabs
//
//  WHAT THE UI LISTENS TO (core/bus.js): doc:change, select, hover, tool,
//  place:end, sim:event (toasts, CHECKS rows, the smoke hiss), sim:serial
//  (the monitor), sim:state (run button, ratio). Frames come in through
//  ui.setFrame (main.js), netlists through ui.setNetlist.
//
//  A selection opens INSPECT by itself (as the SDF lab does). Closing it
//  holds it shut for that selection only.
//
//  GREP MAP
//    WIRE_COLORS / SPEEDS ... the eight jumper colours, the speed menu
//    createUI ............... the export; C is the context every panel gets
//    ensure ................. find or make a DOM id
//    newId / defOf / partName / describeEnd ... small lookups
//    rotate / duplicate / remove ... selection actions as store ops
//    buildBar ............... the top bar
//    instruments ............ the #instrDock cards (reconcile on doc change)
//    leadMode ............... plug a probe lead by clicking a hole
//    contextMenu ............ right click / long press on a part
//    status / tooltip ....... the pointer readouts
//    toast .................. squircle toasts that unfold from the status bar
//    keys ................... V W P X R Delete Cmd-Z Cmd-D F T O Space 1-8 Esc
//    setFrame / setNetlist .. the ui API
// ============================================================================
import { h, icon, btn, seg, toggle, well, PanelManager, menu, unfold } from './panels.js';
import { createDock } from './dock.js';
import { createAudio } from './audio.js';
import { createFiles, download, pickFile } from './files.js';
import { createLibraryPanel } from './library.js';
import { createInspector, findItem } from './inspector.js';
import { createChecks } from './checks.js';
import { createMaterials } from './materials.js';
import { createPartEditor } from './part-editor.js';
import { createCode } from './code.js';
import { createExamples } from './examples.js';
import { createFilePanel } from './file-panel.js';
import { createDmmPanel } from '../instruments/meter.js';
import { createScopePanel } from '../instruments/scope.js';
import { createLogicPanel } from '../instruments/logic.js';
import { createSupplyPanel } from '../instruments/supply.js';
import { createFuncgenPanel } from '../instruments/funcgen.js';
import { si, fmtTime, fmtRatio } from './format.js';
import { boardOf } from '../mcu/boards.js';

export const WIRE_COLORS = ['#d63b3b', '#2b2b2b', '#2f80d6', '#4e9a2e', '#e0c126', '#7a6fd8', '#e2704a', '#edede6'];
const WIRE_NAMES = ['red', 'black', 'blue', 'green', 'yellow', 'purple', 'orange', 'white'];
export const SPEEDS = [[10, '×10'], [1, 'real time'], [0.1, '×0.1'], [0.01, '×0.01'], [0.001, '×0.001']];
const PREFIX = { board: 'b', part: 'p', wire: 'w', probe: 'm', material: 'mat-', customPart: 'cp-' };
const UI_KEY = 'bblab:ui';

export function createUI({ store, registry, bus, view, sim, mcu, materials }) { // eslint-disable-line prefer-const
  const ensure = (id, tag = 'div') => {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement(tag); el.id = id; document.body.appendChild(el); }
    return el;
  };
  const D = {
    stage: ensure('stage'), bar: ensure('bar', 'header'), left: ensure('leftCol', 'aside'), right: ensure('rightCol', 'aside'),
    instr: ensure('instrDock'), status: ensure('status', 'footer'), toasts: ensure('toasts'), dock: ensure('dock', 'nav'), sheet: ensure('sheet'),
    nogl: ensure('nogl'), tip: ensure('tip')
  };
  D.left.classList.add('col'); D.right.classList.add('col');
  D.tip.classList.add('sq'); D.tip.hidden = true; D.tip.setAttribute('role', 'tooltip');
  D.toasts.setAttribute('aria-live', 'polite');
  const offs = [];
  const on = (type, fn) => { const off = bus.on(type, fn); if (typeof off === 'function') offs.push(off); };
  const listen = (el, type, fn, opt) => { el.addEventListener(type, fn, opt); offs.push(() => el.removeEventListener(type, fn, opt)); };

  // Panels edit through this wrapper: an op that the store refuses (the item
  // went away meanwhile) becomes a toast instead of an exception in a handler.
  const raw = store;
  store = {
    get doc() { return raw.doc; }, get canUndo() { return raw.canUndo; }, get canRedo() { return raw.canRedo; },
    apply(op, opts) { try { return raw.apply(op, opts); } catch (e) { toast('warn', 'That edit did not apply: ' + e.message); return null; } },
    undo: () => raw.undo(), redo: () => raw.redo(), load: d => raw.load(d),
    newId: typeof raw.newId === 'function' ? k => raw.newId(k) : undefined
  };

  // ── the context every panel gets ──
  let localSeq = 0, dirty = false, hintText = '', issueCounts = { error: 0, warn: 0, info: 0 }, ready = false;
  const C = {
    store, registry, bus, view, sim, mcu, materials,
    files: createFiles(), audio: createAudio(),
    sel: [], frame: null, netlist: null, running: false, speed: 1, WIRE_COLORS,
    phone: () => dock.phone,
    newId(kind) {
      if (typeof store.newId === 'function') return store.newId(kind);
      const n = Math.max(store.doc.nextId | 0, 1) + localSeq++;
      return PREFIX[kind] + n;
    },
    defOf(id) {
      let d = null;
      try { d = registry.get(id); } catch (e) { d = null; }
      return d || (store.doc.customParts || []).find(x => x.id === id) || null;
    },
    isMcu: defId => !!boardOf(defId),
    boardOf,
    partName(id) {
      const p = store.doc.parts.find(q => q.id === id);
      if (!p) return id;
      const d = C.defOf(p.def);
      return p.label || `${d ? d.name : p.def} ${id}`;
    },
    describeEnd(end) {
      if (!end) return '—';
      if (end.hole) return end.hole;
      if (end.part) return `${C.partName(end.part)} · ${end.pin}`;
      return '?';
    },
    materialList() {
      const seen = new Set(), out = [];
      for (const m of [...((materials && materials.MATERIAL_PRESETS) || []), ...(store.doc.materials || []), ...C.files.libMaterials()]) { if (seen.has(m.id)) continue; seen.add(m.id); out.push(m); }
      return out;
    },
    toast: (level, text, opts) => toast(level, text, opts),
    hint: t => { hintText = t || ''; renderStatus(); },
    select(ids) {
      if (typeof view.select === 'function') view.select(ids);
      else bus.emit('select', { ids, source: 'ui' });
      setSel(ids);
    },
    rotate, duplicate, remove,
    loadDoc, resetBench, importFile: () => filePanel.pick(), importPart: def => { panels.open('parts', tabBtn('parts')); partsPanel.importDef(def); },
    download: (name, text) => download(name, text),
    openMaterials(target) { materialsPanel.setTarget(target); openPanel('materials'); },
    openCode(partId) { openPanel('code'); codePanel.show(partId); },
    showInstrument(id) { const c = cards.get(id); if (!c) return; c.card.classList.remove('min'); if (dock.phone) dock.openTab('instr'); if (c.card.scrollIntoView) c.card.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); },
    setIssueCount(c) { issueCounts = c; renderStatus(); },
    highlightTarget(t) { const n = nodeOf(t); if (n !== null && view.highlightNet) view.highlightNet(n); },
    cancelPlace() { try { view.setTool && view.setTool(tool); } catch (e) { /* ignore */ } },
    closeSheet: () => dock.close(),
    refresh: reason => refreshAll(reason),
    isDirty: () => dirty
  };

  // ── panels ──
  const panels = new PanelManager({ phone: () => dock.phone, sheetBody: null, onChange: () => { syncTabs(); saveUi(); } });
  C.panels = panels;
  const libraryPanel = createLibraryPanel(C);
  const inspector = createInspector(C);
  const checks = createChecks(C);
  const examples = createExamples(C);
  const materialsPanel = createMaterials(C);
  const partsPanel = createPartEditor(C);
  const codePanel = createCode(C);
  const filePanel = createFilePanel(C);
  const PANELS = [libraryPanel, inspector, checks, examples, materialsPanel, partsPanel, codePanel, filePanel];
  const byKey = Object.fromEntries(PANELS.map(p => [p.key, p]));
  for (const p of PANELS) panels.add(p.key, p.el, p.col === 'left' ? D.left : D.right);
  const rightOrder = [];
  const dismissed = { inspect: null };
  function openPanel(key, from) {
    if (!dock.phone && byKey[key].col === 'right') {
      const i = rightOrder.indexOf(key); if (i >= 0) rightOrder.splice(i, 1); rightOrder.push(key);
      const openRight = rightOrder.filter(k => panels.isOpen(k) || k === key);
      while (openRight.length > 2) { const old = openRight.shift(); panels.close(old); rightOrder.splice(rightOrder.indexOf(old), 1); }
    }
    if (key === 'file') filePanel.update('open');
    if (dock.phone) { dock.openTab(key); return; }
    return panels.open(key, from || tabBtn(key));
  }
  function togglePanel(key, from) {
    if (panels.isOpen(key)) { panels.close(key); if (key === 'inspect') dismissed.inspect = C.sel.join(','); }
    else openPanel(key, from);
  }

  // ── the phone dock and sheet ──
  const instrWrap = h('div.instr-wrap', { style: { display: 'contents' } });
  D.instr.appendChild(instrWrap);
  const toolsPane = h('div.tools-pane');
  const dock = createDock({
    dockEl: D.dock, sheetEl: D.sheet,
    onTab: key => showSheetTab(key),
    onRun: () => toggleRun(),
    onLayout: () => layoutChanged(),
    onMode: () => { panels.sheetBody = dock.body; panels.relayout(); placeInstr(); layoutChanged(); }
  });
  panels.sheetBody = dock.body;
  dock.setTabs([['library', 'LIB'], ['inspect', 'INSPECT'], ['instr', 'INSTR'], ['tools', 'TOOLS'], ['checks', 'CHECKS'], ['examples', 'EXAMPLES'], ['code', 'CODE'], ['materials', 'MATERIALS'], ['parts', 'PARTS'], ['file', 'FILE']].map(([key, label]) => ({ key, label })));
  function showSheetTab(key) {
    for (const p of PANELS) if (p.key !== key && p.el.parentNode === dock.body) { p.el.hidden = true; p.el.classList.remove('is-open'); }
    instrWrap.hidden = key !== 'instr';
    toolsPane.hidden = key !== 'tools';
    if (key === 'instr') { if (instrWrap.parentNode !== dock.body) dock.body.appendChild(instrWrap); instrWrap.style.display = 'flex'; instrWrap.style.flexDirection = 'column'; instrWrap.style.gap = '12px'; if (!cards.size) instrWrap.appendChild(emptyInstr); }
    else if (key === 'tools') { if (toolsPane.parentNode !== dock.body) dock.body.appendChild(toolsPane); }
    else if (byKey[key]) { panels.sheetKey = key; if (key === 'file') filePanel.update('open'); panels.open(key, null); }
  }
  const emptyInstr = h('p.empty', {}, 'No instruments yet. Add a multimeter, a scope or a logic analyzer from LIB › METERS, or a bench supply from POWER.');
  function placeInstr() {
    if (dock.phone) { if (dock.tab === 'instr') { dock.body.appendChild(instrWrap); instrWrap.hidden = false; } else instrWrap.hidden = true; }
    else { D.instr.appendChild(instrWrap); instrWrap.hidden = false; instrWrap.style.display = 'contents'; if (emptyInstr.parentNode) emptyInstr.remove(); }
  }

  // ── the top bar ──
  let tool = 'select', wireColor = WIRE_COLORS[0], wireStyle = 'arch', flow = false;
  const tabBtns = {};
  const tabBtn = key => tabBtns[key] || null;
  function buildBar() {
    const title = h('div.sq.grp.title', {}, h('b', {}, 'BREADBOARD LAB'));
    const tabs = h('div.sq.grp');
    for (const [key, label, ico] of [['library', 'Library', 'lib'], ['inspect', 'Inspect', 'inspect'], ['checks', 'Checks', 'checks'], ['examples', 'Examples', 'examples'], ['code', 'Code', 'code'], ['materials', 'Materials', 'mat'], ['parts', 'Part editor', 'parts'], ['file', 'File, save, share', 'file']]) {
      const b = btn('', { ico, title: label, onClick: () => togglePanel(key, b) });
      b.setAttribute('aria-label', label);
      tabBtns[key] = b; tabs.appendChild(b);
    }
    const tools = h('div.sq.grp');
    for (const [t, label, ico, k] of [['select', 'Select and move', 'select', 'V'], ['wire', 'Draw wires', 'wire', 'W'], ['probe', 'Probe a net', 'probe', 'P'], ['delete', 'Delete', 'del', 'X']]) {
      const b = btn('', { ico, title: `${label} (${k})`, onClick: () => setTool(t) });
      b.dataset.tool = t; b.setAttribute('aria-label', label); tools.appendChild(b);
    }
    const sw = h('div.swatches');
    WIRE_COLORS.forEach((c, i) => {
      const b = h('button', { type: 'button', style: { '--c': c }, title: `${WIRE_NAMES[i]} wire (${i + 1})`, 'aria-label': `${WIRE_NAMES[i]} wire` });
      b.dataset.c = c; b.addEventListener('click', () => setWireColor(c)); sw.appendChild(b);
    });
    tools.appendChild(sw);
    const styleSeg = seg([{ value: 'arch', label: 'ARCH', title: 'A bent jumper that rises and arcs' }, { value: 'flat', label: 'FLAT', title: 'A pre-cut jumper flat on the board' }, { value: 'free', label: 'FREE', title: 'Click to add bend points' }], wireStyle, v => setWireStyle(v));
    tools.appendChild(styleSeg.el);
    const run = h('div.sq.grp');
    const runB = btn('', { ico: 'play', cls: 'runbtn', title: 'Run / pause (Space)', onClick: () => toggleRun() });
    const stepB = btn('', { ico: 'step', title: 'Step 1 ms of sim time', onClick: () => { if (sim.stepOnce) sim.stepOnce(1e-3); } });
    const speedSel = h('select.sq.sel.speed', { 'aria-label': 'Sim speed', title: 'Sim seconds per real second' }, ...SPEEDS.map(([v, l]) => h('option', { value: String(v) }, l)));
    speedSel.value = '1';
    speedSel.addEventListener('change', () => setSpeed(+speedSel.value));
    const resetB = btn('', { ico: 'reset', title: 'Reset the bench: time to 0, every part repaired', onClick: () => resetBench() });
    run.append(runB, stepB, speedSel, resetB);
    const misc = h('div.sq.grp');
    const undoB = btn('', { ico: 'undo', title: 'Undo (Cmd/Ctrl+Z)', onClick: () => store.undo() });
    const redoB = btn('', { ico: 'redo', title: 'Redo (Shift+Cmd/Ctrl+Z)', onClick: () => store.redo() });
    const topB = btn('', { ico: 'top', title: 'Top view (T)', onClick: () => view.topView && view.topView() });
    const orbB = btn('', { ico: 'orbit', title: 'Orbit view (O)', onClick: () => view.orbitView && view.orbitView() });
    const flowB = btn('', { ico: 'flow', title: 'Show current flow', onClick: () => { flow = !flow; flowB.classList.toggle('on', flow); view.setFlow && view.setFlow(flow); saveUi(); } });
    const sndB = btn('', { ico: 'light', title: 'Sound on / off', onClick: () => { C.audio.unlock(); C.audio.setMuted(!C.audio.muted); sndB.classList.toggle('on', !C.audio.muted); saveUi(); } });
    sndB.classList.add('on');
    misc.append(undoB, redoB, topB, orbB, flowB, sndB);
    D.bar.append(title, tabs, h('div.spacer'), tools, run, misc);
    // the phone TOOLS tab gets its own copies
    const pTools = h('div.grid3');
    for (const [t, label] of [['select', 'SELECT'], ['wire', 'WIRE'], ['probe', 'PROBE'], ['delete', 'DELETE']]) { const b = btn(label, { cls: 'small', onClick: () => setTool(t) }); b.dataset.tool = t; pTools.appendChild(b); }
    const pSw = h('div.swatches', { style: { flexWrap: 'wrap', gap: '8px' } });
    WIRE_COLORS.forEach((c, i) => { const b = h('button', { type: 'button', style: { '--c': c }, 'aria-label': `${WIRE_NAMES[i]} wire` }); b.dataset.c = c; b.addEventListener('click', () => setWireColor(c)); pSw.appendChild(b); });
    const pStyle = seg([{ value: 'arch', label: 'ARCH' }, { value: 'flat', label: 'FLAT' }, { value: 'free', label: 'FREE' }], wireStyle, v => setWireStyle(v));
    const pSpeed = speedSel.cloneNode(true);
    pSpeed.value = '1';
    pSpeed.addEventListener('change', () => setSpeed(+pSpeed.value));
    toolsPane.append(h('div.sec', {}, h('span', {}, 'Tool')), pTools, h('div.sec', {}, h('span', {}, 'Wire')), pSw, pStyle.el,
      h('div.sec', {}, h('span', {}, 'Run')), h('div.grid3', {}, btn('STEP 1 ms', { cls: 'small', onClick: () => sim.stepOnce && sim.stepOnce(1e-3) }), pSpeed, btn('RESET', { cls: 'small', onClick: () => resetBench() })),
      h('div.sec', {}, h('span', {}, 'Edit and view')), h('div.grid3', {}, btn('UNDO', { cls: 'small', onClick: () => store.undo() }), btn('REDO', { cls: 'small', onClick: () => store.redo() }), btn('ROTATE', { cls: 'small', onClick: () => rotate(C.sel) }),
        btn('TOP', { cls: 'small', onClick: () => view.topView && view.topView() }), btn('ORBIT', { cls: 'small', onClick: () => view.orbitView && view.orbitView() }), btn('FIT', { cls: 'small', onClick: () => view.fit && view.fit() })),
      toggle('Current flow', flow, v => { flow = v; flowB.classList.toggle('on', v); view.setFlow && view.setFlow(v); }).el,
      toggle('Sound', true, v => { C.audio.unlock(); C.audio.setMuted(!v); sndB.classList.toggle('on', v); }).el);
    return { runB, speedSel, pSpeed, undoB, redoB, styleSeg, pStyle, flowB, sndB };
  }
  const bar = buildBar();
  function syncTabs() { for (const [k, b] of Object.entries(tabBtns)) { const o = panels.isOpen(k); b.classList.toggle('on', o); b.setAttribute('aria-pressed', String(o)); } }
  function setTool(t, fromView = false) {
    tool = t;
    if (!fromView) { try { view.setTool && view.setTool(t); } catch (e) { /* ignore */ } bus.emit('tool', { tool: t, source: 'ui' }); }
    for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === t);
    C.hint({ select: '', wire: C.phone() ? 'Tap a hole, then another, to draw a wire' : 'Click a hole or socket, then another. Esc cancels.', probe: 'Tap a hole to light its net and read its voltage', delete: 'Tap a part, wire or board to remove it' }[t] || '');
  }
  function setWireColor(c) {
    wireColor = c; view.setWireColor && view.setWireColor(c);
    for (const b of document.querySelectorAll('.swatches button[data-c]')) b.classList.toggle('on', b.dataset.c === c);
    if (tool !== 'wire') setTool('wire');
    saveUi();
  }
  function setWireStyle(s) { wireStyle = s; view.setWireStyle && view.setWireStyle(s); bar.styleSeg.set(s); bar.pStyle.set(s); saveUi(); }
  function setSpeed(x, { record = true } = {}) {
    C.speed = x; sim.setSpeed && sim.setSpeed(x);
    bar.speedSel.value = String(x); bar.pSpeed.value = String(x);
    const cur = store.doc.sim || {};
    if (record && cur.speed !== x) store.apply({ op: 'meta', sim: { ...cur, speed: x } }, { merge: 'speed' });
    renderStatus();
  }
  function toggleRun() {
    C.audio.unlock();
    if (C.running) { sim.pause && sim.pause(); setRunning(false); }
    else { sim.start && sim.start(); setRunning(true); }
  }
  function setRunning(r) {
    C.running = r;
    bar.runB.classList.toggle('on', r);
    bar.runB.replaceChild(icon(r ? 'pause' : 'play', 16), bar.runB.firstChild);
    dock.setRunning(r);
    document.body.classList.toggle('running', r);
    if (!r) C.audio.silence();
  }
  function resetBench() {
    sim.reset && sim.reset();
    checks.clearEvents();
    for (const c of cards.values()) if (c.panel.capture) c.panel.capture.clear();
    toast('info', 'Bench reset: time is 0 and every part is new again.');
  }

  // ── selection actions ──
  function rotate(ids) {
    const ops = [];
    for (const id of ids) {
      const f = findItem(store.doc, id); if (!f) continue;
      if (f.kind === 'part') ops.push({ op: 'move', id, place: { ...f.item.place, rot: ((f.item.place.rot || 0) + 1) % 4 } });
      else if (f.kind === 'board') ops.push({ op: 'move', id, place: { x: f.item.x, z: f.item.z, rot: ((f.item.rot || 0) + 1) % 4 } });
      else if (f.kind === 'probe') ops.push({ op: 'move', id, place: { ...f.item.place, rot: ((f.item.place.rot || 0) + 1) % 4 } });
    }
    if (ops.length) store.apply(ops.length === 1 ? ops[0] : { op: 'batch', ops });
  }
  function duplicate(ids) {
    const ops = [], fresh = [];
    for (const id of ids) {
      const f = findItem(store.doc, id); if (!f) continue;
      const copy = JSON.parse(JSON.stringify(f.item));
      if (f.kind === 'part') {
        copy.id = C.newId('part');
        copy.place = { ...copy.place, x: copy.place.x + (copy.place.on ? 3 * 2.54 : 12), z: copy.place.z + (copy.place.on ? 0 : 12) };
        ops.push({ op: 'add', kind: 'part', item: copy });
        const prog = store.doc.programs && store.doc.programs[id];
        if (prog) ops.push({ op: 'program', id: copy.id, program: JSON.parse(JSON.stringify(prog)) });
      } else if (f.kind === 'board') {
        copy.id = C.newId('board');
        const w = { bb830: 165.1, bb400: 82.6, bb170: 45.7 }[copy.type] || 80;
        copy.x += w + 4;
        ops.push({ op: 'add', kind: 'board', item: copy });
      } else continue;
      fresh.push(copy.id);
    }
    if (!ops.length) { toast('info', 'Only parts and boards can be duplicated.'); return; }
    store.apply({ op: 'batch', ops });
    C.select(fresh);
  }
  function remove(ids) {
    const ok = ids.filter(id => findItem(store.doc, id));
    if (!ok.length) return;
    store.apply({ op: 'remove', ids: ok });
    setSel([]);
  }
  function loadDoc(doc, { example } = {}) {
    store.load(doc);
    dirty = false;
    setSel([]);
    if (example) examples.setCurrent(example);
    checks.clearEvents();
    if (doc.sim && doc.sim.speed) setSpeed(doc.sim.speed, { record: false });
  }

  // ── instruments in the dock ──
  const cards = new Map();   // id -> { card, panel, kind }
  const widgetCtx = { h, btn, seg, well, toggle, store, sim, describeEnd: e => C.describeEnd(e), onSelectLead: (p, l) => startLead(p, l) };
  function makeCard(id, title, panel, kind) {
    const minB = h('button.ph-x', { type: 'button', title: 'Fold', 'aria-label': `Fold ${title}` }, icon('more', 14));
    const head = h('div.ph', {}, h('h2', {}, title), minB);
    const body = h('div.pb', {}, panel.el);
    const card = h(`section.sq.instr-card.${kind}`, { 'aria-label': title }, head, body);
    minB.addEventListener('click', () => { card.classList.toggle('min'); measureInstr(); });
    head.addEventListener('dblclick', () => { card.classList.toggle('min'); measureInstr(); });
    return card;
  }
  function reconcileInstruments() {
    const doc = store.doc;
    const want = new Map();
    for (const p of doc.probes || []) want.set(p.id, { kind: p.type, item: p });
    for (const p of doc.parts) if (p.def === 'supply-bench' || p.def === 'funcgen') want.set(p.id, { kind: p.def, item: p });
    for (const [id, c] of cards) if (!want.has(id) || want.get(id).kind !== c.kind) { const el = c.card; unfold(el, { open: false }).then(() => el.remove()); cards.delete(id); }
    for (const [id, w] of want) {
      let c = cards.get(id);
      if (!c) {
        const ctx = widgetCtx;
        let panel, title;
        if (w.kind === 'dmm') { panel = createDmmPanel(w.item, ctx); title = 'Multimeter'; }
        else if (w.kind === 'scope') { panel = createScopePanel(w.item, ctx); title = 'Oscilloscope'; }
        else if (w.kind === 'logic') { panel = createLogicPanel(w.item, ctx); title = 'Logic analyzer'; }
        else if (w.kind === 'supply-bench') { panel = createSupplyPanel(w.item, ctx); title = 'Bench supply'; }
        else if (w.kind === 'funcgen') { panel = createFuncgenPanel(w.item, ctx); title = 'Function generator'; }
        else continue;
        const card = makeCard(id, `${title} · ${w.item.label || id}`, panel, w.kind);
        card.hidden = true;
        instrWrap.appendChild(card);
        unfold(card, { open: true, from: D.status, radius: 18 });
        c = { card, panel, kind: w.kind, item: w.item };
        cards.set(id, c);
        if (emptyInstr.parentNode) emptyInstr.remove();
      } else if (c.item !== w.item) {
        c.item = w.item;
        if (c.panel.setProbe) c.panel.setProbe(w.item); else if (c.panel.setPart) c.panel.setPart(w.item);
      }
    }
    measureInstr();
  }
  function measureInstr() {
    const run = () => {
      const hgt = !dock.phone && cards.size ? D.instr.offsetHeight : 0;
      document.body.style.setProperty('--instr-h', hgt + 'px');
      layoutChanged();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else run();
  }

  // ── leads: press a lead button, then click a hole ──
  let lead = null, prevTool = null;
  function startLead(probeId, name) {
    lead = { probe: probeId, lead: name };
    prevTool = tool;
    setTool('probe');
    C.hint(`Click a hole or a pin for ${name.toUpperCase()} (Esc cancels)`);
    toast('info', `Now click a hole or a pin for the ${name.toUpperCase()} lead.`);
  }
  function endLead() { lead = null; if (prevTool) setTool(prevTool); prevTool = null; C.hint(''); }
  let downAt = null;
  const canvas = view.canvas || D.stage.querySelector('canvas') || D.stage;
  listen(canvas, 'pointerdown', e => { downAt = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; C.audio.unlock(); }, true);
  listen(canvas, 'pointerup', e => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6;
    downAt = null;
    if (!lead || moved) return;
    const t = view.pick ? view.pick(e.clientX, e.clientY) : null;
    if (!t || (t.kind !== 'hole' && t.kind !== 'pin')) return;
    const end = t.kind === 'hole' ? { hole: t.hole } : { part: t.part, pin: t.pin };
    store.apply({ op: 'set', id: lead.probe, path: 'leads.' + lead.lead, value: end });
    toast('info', `${lead.lead.toUpperCase()} → ${C.describeEnd(end)}`);
    endLead();
  }, true);

  // ── context menu: the view raises 'context' for a right click or a long press ──
  function contextMenu(x, y, target) {
    const t = target !== undefined ? target : (view.pick ? view.pick(x, y) : null);
    const id = t && (t.id || (t.kind === 'pin' ? t.part : t.kind === 'lead' ? t.probe : null));
    if (!id || !findItem(store.doc, id)) return;
    if (!C.sel.includes(id)) C.select([id]);
    const f = findItem(store.doc, id);
    const items = [];
    if (f.kind === 'part' || f.kind === 'board' || f.kind === 'probe') items.push({ label: 'Rotate', kbd: 'R', onClick: () => rotate([id]) });
    if (f.kind === 'part' || f.kind === 'board') items.push({ label: 'Duplicate', kbd: '⌘D', onClick: () => duplicate([id]) });
    const pf = C.frame && C.frame.parts && C.frame.parts[id];
    if (f.kind === 'part' && pf && pf.damaged) items.push({ label: 'Replace part', onClick: () => sim.repair && sim.repair(id) });
    if (f.kind === 'part' && C.isMcu(f.item.def)) items.push({ label: 'Open code', onClick: () => C.openCode(id) });
    items.push({ label: 'Inspect', onClick: () => openPanel('inspect') });
    if (view.focus) items.push({ label: 'Focus', kbd: 'F', onClick: () => view.focus(id) });
    items.push('-', { label: 'Delete', kbd: '⌫', danger: true, onClick: () => remove([id]) });
    menu(x, y, items);
  }

  // ── status and tooltip ──
  const st = {
    t: h('span.sq.stat', { title: 'Sim time' }, 't ', h('b', {}, '0.000 s')),
    ratio: h('span.sq.stat.ratio', { title: 'Sim speed against real time' }, h('b', {}, '—')),
    v: h('span.sq.stat.v', { title: 'The voltage under the pointer' }, 'V ', h('b', {}, '—')),
    n: h('button.sq.stat.issues-n', { type: 'button', title: 'Open CHECKS' }, 'checks ', h('b', {}, '0')),
    hint: h('span.sq.stat.hint')
  };
  st.n.addEventListener('click', () => openPanel('checks'));
  D.status.append(st.t, st.ratio, st.v, st.n, st.hint);
  ready = true;
  let simState = { running: false, t: 0, ratio: 0, speed: 1 };
  let hoverT = null;
  function nodeOf(t) {
    const N = C.netlist; if (!N || !t) return null;
    if (t.kind === 'hole') return N.holeNode && N.holeNode[t.hole] !== undefined ? N.holeNode[t.hole] : null;
    if (t.kind === 'pin') { const n = N.pinNode && N.pinNode[t.part + '.' + t.pin]; return n === undefined ? null : n; }
    return null;
  }
  function voltOf(t) { const n = nodeOf(t); const V = C.frame && C.frame.nodeV; return n === null || !V || n >= V.length ? null : V[n]; }
  function renderStatus() {
    if (!ready) return;
    st.t.lastChild.textContent = fmtTime(simState.t || (C.frame ? C.frame.t : 0));
    st.ratio.lastChild.textContent = simState.running ? fmtRatio(simState.ratio) + (C.speed !== 1 ? ` of ${SPEEDS.find(s => s[0] === C.speed)?.[1] || C.speed}` : '') : 'paused';
    const v = voltOf(hoverT);
    st.v.lastChild.textContent = v === null ? '—' : si(v, 'V');
    const n = issueCounts.error + issueCounts.warn;
    st.n.lastChild.textContent = String(n);
    st.n.classList.toggle('bad', issueCounts.error > 0); st.n.classList.toggle('warn', !issueCounts.error && issueCounts.warn > 0);
    st.hint.textContent = hintText;
  }
  function tooltip(t, x, y) {
    if (!t || C.phone()) { D.tip.hidden = true; return; }
    const v = voltOf(t);
    let title = '', rows = [];
    if (t.kind === 'hole') { title = t.hole; const n = nodeOf(t); if (n !== null && C.netlist && C.netlist.nodeNames) rows.push(C.netlist.nodeNames[n] || ''); }
    else if (t.kind === 'pin') { const p = store.doc.parts.find(q => q.id === t.part); const d = p && C.defOf(p.def); const pin = d && (d.pins || []).find(q => q.name === t.pin); title = `${C.partName(t.part)} · ${pin && pin.label ? pin.label : t.pin}`; }
    else if (t.kind === 'part') { title = C.partName(t.id); const s = C.frame && C.frame.parts && C.frame.parts[t.id]; if (s && s.i !== undefined) rows.push(`<span class="a">${si(s.i, 'A')}</span>`); if (s && s.damaged) rows.push(`<span style="color:var(--bad)">${s.damaged}</span>`); }
    else if (t.kind === 'wire') { title = 'wire ' + t.id; const k = C.netlist && C.netlist.wireIds ? C.netlist.wireIds.indexOf(t.id) : -1; if (k >= 0 && C.frame && C.frame.wires) rows.push(`<span class="a">${si(C.frame.wires[k], 'A')}</span>`); }
    else if (t.kind === 'board') title = 'board ' + t.id;
    else if (t.kind === 'probe' || t.kind === 'lead') title = t.kind === 'lead' ? `${t.lead.toUpperCase()} lead` : 'instrument';
    if (v !== null) rows.unshift(`<span class="v">${si(v, 'V')}</span>`);
    D.tip.innerHTML = `<div class="t">${title.replace(/[<>&]/g, '')}</div>${rows.filter(Boolean).join(' · ')}`;
    D.tip.style.left = x + 'px'; D.tip.style.top = y + 'px';
    D.tip.hidden = false;
  }

  // ── toasts ──
  const recent = new Map();
  function toast(level = 'info', text = '', { actions = [], ms } = {}) {
    const key = level + text;
    const now = Date.now();
    if (recent.has(key) && now - recent.get(key) < 2500) return null;
    recent.set(key, now);
    const el = h(`div.sq.toast.${level}`, { role: level === 'error' ? 'alert' : 'status', hidden: true }, h('i'), h('span', {}, text));
    if (actions.length) el.appendChild(h('span.acts', {}, ...actions.map(a => btn(a.label, { cls: 'small', onClick: () => { a.onClick(); close(); } }))));
    D.toasts.appendChild(el);
    while (D.toasts.children.length > 4) D.toasts.firstChild.remove();
    unfold(el, { open: true, from: D.status, radius: 12, content: null });
    let timer = setTimeout(close, ms || (level === 'error' ? 9000 : level === 'warn' ? 6500 : 4200));
    el.addEventListener('pointerenter', () => clearTimeout(timer));
    el.addEventListener('pointerleave', () => { timer = setTimeout(close, 2500); });
    let closing = false;
    function close() { if (closing) return; closing = true; clearTimeout(timer); unfold(el, { open: false, from: D.status, radius: 12, content: null }).then(() => el.remove()); }
    return { el, close };
  }

  // ── keys ──
  function typing(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }
  listen(document, 'keydown', e => {
    if (typing(e)) return;
    const k = e.key, mod = e.metaKey || e.ctrlKey;
    if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
    if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); store.redo(); return; }
    if (mod && (k === 'd' || k === 'D')) { e.preventDefault(); if (C.sel.length) duplicate(C.sel); return; }
    if (mod || e.altKey) return;
    switch (k) {
      case 'v': case 'V': setTool('select'); break;
      case 'w': case 'W': setTool('wire'); break;
      case 'p': case 'P': setTool('probe'); break;
      case 'x': case 'X': setTool('delete'); break;
      case 'r': case 'R': if (C.sel.length) rotate(C.sel); break;
      case 'Delete': case 'Backspace': if (C.sel.length) { e.preventDefault(); remove(C.sel); } break;
      case 'f': case 'F': if (C.sel.length && view.focus) view.focus(C.sel[0]); else if (view.fit) view.fit(); break;
      case 't': case 'T': view.topView && view.topView(); break;
      case 'o': case 'O': view.orbitView && view.orbitView(); break;
      case ' ': e.preventDefault(); toggleRun(); break;
      case 'Escape':
        if (lead) { endLead(); break; }
        libraryPanel.clearArm();
        if (dock.phone && dock.open) { dock.close(); break; }
        if (C.sel.length) C.select([]);
        C.hint('');
        break;
      default:
        if (/^[1-8]$/.test(k)) setWireColor(WIRE_COLORS[+k - 1]);
        else return;
    }
  });

  // ── bus ──
  function setSel(ids) {
    const doc = store.doc;
    C.sel = (ids || []).filter(id => findItem(doc, id));
    if (!C.sel.length) dismissed.inspect = null;
    inspector.update('select'); materialsPanel.update('select');
    if (C.sel.length && !dock.phone && !panels.isOpen('inspect') && dismissed.inspect !== C.sel.join(',')) openPanel('inspect');
  }
  on('select', ({ ids = [], source } = {}) => { if (source === 'ui') return; setSel(ids); });
  on('hover', ({ target = null, x = 0, y = 0 } = {}) => { hoverT = target; renderStatus(); tooltip(target, x, y); });
  on('tool', ({ tool: t, source } = {}) => { if (source === 'ui' || !t) return; setTool(t, true); if (t !== 'probe' && lead) endLead(); });
  on('doc:change', ({ source } = {}) => {
    if (source === 'user' || source === 'undo' || source === 'redo') dirty = true;
    refreshAll('doc');
    scheduleAutosave();
  });
  on('sim:state', s => {
    simState = { ...simState, ...s };
    if (typeof s.running === 'boolean' && s.running !== C.running) setRunning(s.running);
    if (typeof s.speed === 'number') C.speed = s.speed;
    renderStatus();
  });
  on('sim:serial', ({ mcu: id, text } = {}) => { if (id && text) codePanel.serial(id, text); });
  on('sim:event', e => {
    if (!e) return;
    checks.event(e);
    if (e.smoke) C.audio.hiss();
    if (e.severity === 'error' || e.severity === 'warn') {
      const actions = e.owner && e.kind === 'damage' && findItem(store.doc, e.owner) ? [{ label: 'Replace part', onClick: () => sim.repair && sim.repair(e.owner) }, { label: 'Show', onClick: () => { view.focus && view.focus(e.owner); C.select([e.owner]); } }] : [];
      toast(e.severity, e.msg, { actions });
    }
  });
  on('camera', () => layoutChanged());
  on('toast', ({ level = 'info', text = '' } = {}) => { if (text) toast(level, text); });
  on('context', ({ target = null, x = 0, y = 0 } = {}) => contextMenu(x, y, target));

  function refreshAll(reason) {
    C.sel = C.sel.filter(id => findItem(store.doc, id));
    for (const p of PANELS) p.update && p.update(reason);
    if (reason === 'doc' || reason === 'registry') { reconcileInstruments(); bar.undoB.disabled = !store.canUndo; bar.redoB.disabled = !store.canRedo; }
    renderStatus();
  }
  let autoT = null;
  function scheduleAutosave() { clearTimeout(autoT); autoT = setTimeout(() => C.files.autosave(store.doc), 1500); }

  // ── per-viewer layout memory (localStorage, never required) ──
  function saveUi() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ open: PANELS.filter(p => panels.isOpen(p.key)).map(p => p.key), wireColor, wireStyle, flow, muted: C.audio.muted })); } catch (e) { /* storage blocked */ }
  }
  function loadUi() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(UI_KEY) || 'null'); } catch (e) { s = null; }
    return s || { open: ['library'], wireColor: WIRE_COLORS[0], wireStyle: 'arch', flow: false, muted: false };
  }

  // ── layout: the view frames the bench between the columns ──
  function insets() {
    if (dock.phone) return { left: 0, right: 0, top: 0, bottom: 40 };
    const lw = PANELS.some(p => p.col === 'left' && panels.isOpen(p.key)) ? D.left.offsetWidth + 14 : 0;
    const rw = PANELS.some(p => p.col === 'right' && panels.isOpen(p.key)) ? D.right.offsetWidth + 14 : 0;
    return { left: lw, right: rw, top: 56, bottom: 50 + (cards.size ? D.instr.offsetHeight : 0) };
  }
  let lastInsets = '';
  function layoutChanged() {
    const i = insets(), k = JSON.stringify(i);
    if (k !== lastInsets) { lastInsets = k; bus.emit('layout', i); }
  }

  // ── start ──
  const saved = loadUi();
  dock.setMode();
  panels.relayout();
  placeInstr();
  setTool('select');
  setWireStyle(saved.wireStyle || 'arch');
  wireColor = saved.wireColor || WIRE_COLORS[0];
  try { view.setWireColor && view.setWireColor(wireColor); } catch (e) { /* ignore */ }
  for (const b of document.querySelectorAll('.swatches button[data-c]')) b.classList.toggle('on', b.dataset.c === wireColor);
  if (saved.flow) { flow = true; bar.flowB.classList.add('on'); view.setFlow && view.setFlow(true); }
  if (saved.muted) { C.audio.setMuted(true); bar.sndB.classList.remove('on'); }
  if (!dock.phone) for (const k of saved.open || ['library']) if (byKey[k] && k !== 'inspect') openPanel(k);
  refreshAll('doc');
  if (store.doc.sim && store.doc.sim.speed) setSpeed(store.doc.sim.speed, { record: false });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measureInstr()) : null;
  if (ro) ro.observe(D.instr);
  listen(window, 'resize', () => { measureInstr(); layoutChanged(); });

  // the audio follows the frames; the 3D screens redraw at 10 Hz
  let screenT = 0;
  const audioKinds = () => {
    const m = new Map();
    for (const p of store.doc.parts) { const d = C.defOf(p.def); const v = d && d.visual; if (v === 'buzzer' || v === 'speaker' || v === 'relay') m.set(p.id, v); }
    return m;
  };
  let kindsCache = null, kindsDoc = null;

  const ui = {
    setFrame(frame) {
      if (!frame) return;
      C.frame = frame;
      if (typeof frame.running === 'boolean' && frame.running !== C.running) setRunning(frame.running);
      simState.t = frame.t; if (frame.ratio !== undefined) simState.ratio = frame.ratio;
      for (const [id, c] of cards) {
        if (c.kind === 'supply-bench' || c.kind === 'funcgen') c.panel.frame(frame.parts && frame.parts[id]);
        else c.panel.frame(frame.probes && frame.probes[id], C.running);
      }
      inspector.frame(); codePanel.frame(frame);
      if (kindsDoc !== store.doc) { kindsDoc = store.doc; kindsCache = audioKinds(); }
      C.audio.update(frame, kindsCache, C.running);
      let beep = false;
      for (const c of cards.values()) if (c.kind === 'dmm') { const fp = frame.probes && frame.probes[c.item.id]; if (fp && fp.beep && (c.item.settings || {}).mode === 'cont') beep = true; }
      C.audio.beep(beep);
      const now = performance.now();
      if (now - screenT > 100 && view.screens) {
        screenT = now;
        for (const [id, c] of cards) if (c.panel.draw3D) { let s = null; try { s = view.screens(id); } catch (e) { s = null; } if (s) c.panel.draw3D(s); }
      }
      renderStatus();
    },
    setNetlist(netlist) {
      C.netlist = netlist;
      checks.setIssues(netlist && netlist.issues);
      inspector.update('netlist');
      renderStatus();
    },
    toast: (level, text, opts) => toast(level, text, opts),
    open: key => (byKey[key] ? openPanel(key) : key === 'instr' ? (dock.phone ? dock.openTab('instr') : null) : null),
    close: key => panels.close(key),
    examples: list => examples.setList(list),
    showNoGL(msg) { D.nogl.classList.add('sq'); D.nogl.textContent = msg || 'This page needs WebGL. The 3D bench cannot start in this browser.'; D.nogl.hidden = false; },
    insets,
    instrument: id => (cards.get(id) || {}).panel || null,
    get audio() { return C.audio; },
    get selection() { return C.sel.slice(); },
    pickFile,
    dispose() {
      for (const off of offs) { try { off(); } catch (e) { /* ignore */ } }
      if (ro) ro.disconnect();
      clearTimeout(autoT);
      C.audio.close();
    }
  };
  D.nogl.hidden = true;
  return ui;
}
