// ============================================================================
//  BREADBOARD LAB  ·  ui/part-editor.js — the PARTS panel (custom parts)
// ----------------------------------------------------------------------------
//  Make a new part from data (CONTRACT 1.4, 3.5): a name and category, a 3D
//  template with its parameters, pins on a 0.1 inch grid (click the grid to
//  add a pin, click a pin to pick it, name it in the list), material slots,
//  and an electrical model:
//    none ........ the part is only a shape
//    built-in .... one element of CONTRACT 3.7 (a resistor, an LED, a relay…)
//                  with each of its terminals mapped to a pin, and its params
//    subcircuit .. several primitive elements; a terminal maps to a pin or to
//                  an internal node '#name' of the part
//    logic ....... output expressions of the input pins (Y = !(A & B)), with
//                  a VCC and a GND pin: a `logic-expr` element
//  SAVE validates with registry.validate, adds the def to the registry and
//  to the document (so a shared link carries it). SAVE TO LIBRARY keeps it
//  in this browser. Export and import as JSON. Pin 1 moves to (0, 0) on
//  save, as the schema wants for board parts.
//
//  GREP MAP
//    ELEMENTS ............ element types -> terminals and default params
//    TEMPLATES ........... data templates -> their params
//    blankDef ............ a new part
//    createPartEditor .... the panel: list, form, grid, pins, slots, model
//    drawGrid ............ the pin grid canvas
//    buildDef ............ the working copy -> a PartDef
// ============================================================================
import { h, makePanel, btn, seg, well, sec, note, chip } from './panels.js';

export const ELEMENTS = {
  resistor: [['a', 'b'], { r: 1000, pmax: 0.25 }], capacitor: [['a', 'b'], { c: 1e-6 }], inductor: [['a', 'b'], { l: 1e-3 }],
  diode: [['a', 'k'], { model: '1n4148' }], zener: [['a', 'k'], { vz: 5.1 }], led: [['a', 'k'], { color: 'red' }],
  npn: [['c', 'b', 'e'], { model: '2n3904' }], pnp: [['c', 'b', 'e'], { model: '2n3906' }], nmos: [['d', 'g', 's'], { model: '2n7000' }], pmos: [['d', 'g', 's'], { model: 'p-to220' }],
  switch: [['a', 'b'], { on: false }], button: [['a', 'b'], { pressed: false }], spdt: [['com', 'a', 'b'], { pos: 0 }],
  relay: [['c1', 'c2', 'com', 'no', 'nc'], { coilR: 70 }], pot: [['a', 'w', 'b'], { r: 10000, pos: 0.5 }],
  ldr: [['a', 'b'], { lux: 100 }], thermistor: [['a', 'b'], { r25: 10000, beta: 3950, tempC: 25 }], fuse: [['a', 'b'], { rating: 0.5 }],
  lamp: [['a', 'b'], { vnom: 6, pnom: 0.6 }], buzzer: [['a', 'b'], { active: true }], speaker: [['a', 'b'], { r: 8 }], motor: [['a', 'b'], { r: 5 }],
  battery: [['p', 'n'], { v: 3, rint: 0.2, mah: 1000, soc: 1 }], vsource: [['p', 'n'], { wave: { kind: 'dc', v: 5 } }], regulator: [['in', 'gnd', 'out'], { model: '7805' }],
  opamp: [['inp', 'inn', 'out', 'vcc', 'vee'], { model: 'lm358' }], wire: [['a', 'b'], { r: 0.02 }]
};
const PRIMITIVES = ['resistor', 'capacitor', 'inductor', 'diode', 'led', 'switch', 'button', 'wire', 'npn', 'nmos'];
export const TEMPLATES = {
  dip: { pins: 8, label: 'CHIP' }, 'sip-module': { pins: 4, bodyW: 20, bodyD: 14, pcb: 'pcb-blue', label: 'MODULE', top: 'chip' },
  axial: { len: 6.5, dia: 2.4, bands: '' }, radial: { dia: 5, h: 11 }, box: { w: 10, d: 8, h: 6, r: 1 }, to92: {}, to220: {},
  cylinder: { dia: 8, h: 10 }, 'header-board': { w: 25, d: 18, rows: 1 }
};
const CATS = ['custom', 'power', 'passive', 'semis', 'ics', 'output', 'input', 'sensors', 'modules'];

export function blankDef(id) {
  return {
    id, name: 'My part', category: 'custom', tags: [], desc: '', mount: 'board',
    pins: [{ name: '1', x: 0, z: 0 }, { name: '2', x: 3, z: 0 }], params: [],
    electrical: [{ id: 'main', type: 'resistor', nodes: { a: '1', b: '2' }, params: { r: 1000 } }],
    slots: [{ key: 'body', label: 'Body', default: 'abs-black' }, { key: 'legs', label: 'Legs', default: 'tin' }],
    model: { template: 'box', w: 8, d: 5, h: 5, r: 1 }, visual: 'none'
  };
}
const clone = o => JSON.parse(JSON.stringify(o));
const stop = el => { el.addEventListener('keydown', e => e.stopPropagation()); return el; };
const modeOf = def => {
  const E = def.electrical || [];
  if (!E.length) return 'none';
  if (E.length === 1 && E[0].type === 'logic-expr') return 'logic';
  if (E.length === 1) return 'builtin';
  return 'subcircuit';
};

export function createPartEditor(C) {
  const P = makePanel({ id: 'p-parts', title: 'Part editor', onClose: () => C.panels.close('parts') });
  let wd = null, isNew = false, selPin = 0, mode = 'builtin', errors = [];
  const listBox = h('div');
  const form = h('div');
  P.body.append(listBox, form);

  const customs = () => {
    const seen = new Set(), out = [];
    for (const [src, L] of [['doc', C.store.doc.customParts || []], ['lib', C.files.libParts()]]) for (const d of L) { if (seen.has(d.id)) continue; seen.add(d.id); out.push({ src, def: d }); }
    return out;
  };
  function renderList() {
    listBox.innerHTML = '';
    const L = customs();
    const chips = h('div.chips', {}, ...L.map(({ src, def }) => {
      const b = chip(def.name + (src === 'lib' ? ' ·lib' : ''), { title: def.id, onClick: () => edit(def, false) });
      if (wd && wd.id === def.id) b.classList.add('on');
      return b;
    }));
    listBox.append(sec('Custom parts', String(L.length)), L.length ? chips : note('No custom parts yet.'),
      h('div.grid2', {}, btn('New part', { cls: 'small.primary', onClick: () => edit(blankDef(C.newId('customPart')), true) }), btn('Import JSON', { cls: 'small', onClick: () => C.importFile() })));
  }
  function edit(def, fresh) {
    wd = clone(def); isNew = fresh || !(C.store.doc.customParts || []).some(d => d.id === def.id);
    mode = modeOf(wd); selPin = 0; errors = [];
    render();
  }

  // ── the pin grid ──
  const GRID = 14;
  function drawGrid(cv) {
    const r = cv.getBoundingClientRect();
    const W = Math.max(200, Math.round(r.width || 260)), dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = W * dpr;
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = W / (GRID + 1), o = s / 2 + (GRID / 2) * s;
    g.fillStyle = '#0b0c0e'; g.fillRect(0, 0, W, W);
    g.fillStyle = '#2a2d33';
    for (let i = 0; i <= GRID; i++) for (let j = 0; j <= GRID; j++) { g.beginPath(); g.arc(s / 2 + i * s, s / 2 + j * s, 1.6, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = 'rgba(107,159,226,.25)'; g.beginPath(); g.moveTo(o, 0); g.lineTo(o, W); g.moveTo(0, o); g.lineTo(W, o); g.stroke();
    // body outline from the pin bounds
    if (wd.pins.length) {
      const xs = wd.pins.map(p => +p.x), zs = wd.pins.map(p => +p.z);
      const x0 = Math.min(...xs) - 0.6, x1 = Math.max(...xs) + 0.6, z0 = Math.min(...zs) - 0.6, z1 = Math.max(...zs) + 0.6;
      g.strokeStyle = 'rgba(255,255,255,.18)'; g.setLineDash([4, 4]);
      g.strokeRect(o + x0 * s, o + z0 * s, (x1 - x0) * s, (z1 - z0) * s); g.setLineDash([]);
    }
    g.font = `600 ${Math.round(s * 0.42)}px ui-monospace, Menlo, monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
    wd.pins.forEach((p, i) => {
      const x = o + p.x * s, y = o + p.z * s;
      g.fillStyle = i === selPin ? '#6b9fe2' : '#d6b04a';
      g.beginPath(); g.arc(x, y, s * 0.3, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e2e3e9'; g.fillText(p.name, x, y - s * 0.62);
    });
    return { s, o };
  }

  function buildDef() {
    const d = clone(wd);
    if (d.pins.length) { const p1 = d.pins[0], dx = +p1.x, dz = +p1.z; for (const p of d.pins) { p.x = +p.x - dx; p.z = +p.z - dz; } }
    if (mode === 'none') d.electrical = [];
    if (mode === 'logic' && d.electrical[0]) {
      const el = d.electrical[0], P2 = el.params;
      el.nodes = { ...Object.fromEntries([...(P2.inputs || []), ...Object.keys(P2.outputs || {})].map(n => [n, n])), vcc: P2.vcc, gnd: P2.gnd };
    }
    d.tags = String(d.tags || '').split ? String(d.tags).split(',').map(t => t.trim()).filter(Boolean) : d.tags;
    return d;
  }
  function validate(d) {
    let errs = [];
    try { errs = C.registry.validate ? C.registry.validate(d) || [] : []; } catch (e) { errs = [e.message]; }
    const names = d.pins.map(p => p.name);
    if (new Set(names).size !== names.length) errs.push('two pins have the same name');
    for (const el of d.electrical || []) for (const [term, pin] of Object.entries(el.nodes || {})) if (!(typeof pin === 'string' && (pin.startsWith('#') || names.includes(pin)))) errs.push(`element ${el.id}: terminal ${term} maps to "${pin}", which is not a pin`);
    return [...new Set(errs)];
  }
  function save(toLib) {
    const d = buildDef();
    errors = validate(d);
    if (errors.length) { render(); C.toast('warn', 'The part has problems: see the list.'); return; }
    if (toLib) { const ok = C.files.saveLibPart(d); C.toast('info', ok ? 'Saved to your part library.' : 'Saved for this visit only (storage is blocked).'); }
    try { if (C.registry.get && C.registry.get(d.id)) C.registry.remove(d.id); const r = C.registry.add(d); if (r && r.ok === false) { errors = r.errors || ['the registry refused it']; render(); return; } } catch (e) { errors = [e.message]; render(); return; }
    const existing = (C.store.doc.customParts || []).find(x => x.id === d.id);
    if (!existing) C.store.apply({ op: 'add', kind: 'customPart', item: d });
    else {
      const ops = Object.keys(d).filter(k => k !== 'id' && JSON.stringify(d[k]) !== JSON.stringify(existing[k])).map(k => ({ op: 'set', id: d.id, path: k, value: d[k] }));
      if (ops.length) C.store.apply({ op: 'batch', ops });
    }
    isNew = false; wd = clone(d);
    C.refresh('registry');
    C.toast('info', `${d.name} is in the library under ${d.category.toUpperCase()}.`);
    render();
  }

  function pinRows() {
    const box = h('div.pins');
    wd.pins.forEach((p, i) => {
      const name = stop(h('input.txt', { type: 'text', value: p.name, 'aria-label': 'Pin name' }));
      name.addEventListener('change', () => { const old = p.name; p.name = name.value.trim() || old; for (const el of wd.electrical || []) for (const k of Object.keys(el.nodes)) if (el.nodes[k] === old) el.nodes[k] = p.name; render(); });
      const pos = h('span.dim', {}, `${p.x},${p.z}`);
      const del = btn('×', { cls: 'tiny', title: 'Remove pin', onClick: () => { wd.pins.splice(i, 1); selPin = Math.max(0, Math.min(selPin, wd.pins.length - 1)); render(); } });
      const row = h('div.pinrow', {}, h('b', { style: { color: i === selPin ? 'var(--acc)' : 'var(--gold)' } }, i === 0 ? '1st' : '#' + (i + 1)), name, pos, del);
      row.addEventListener('click', e => { if (e.target === row || e.target.tagName === 'B') { selPin = i; render(); } });
      box.append(row);
    });
    return box;
  }
  function modelBlock() {
    const out = [];
    const tsel = h('select.sq.sel', { 'aria-label': '3D template' }, ...Object.keys(TEMPLATES).map(t => h('option', { value: t }, t)));
    tsel.value = wd.model.template;
    tsel.addEventListener('change', () => { wd.model = { template: tsel.value, ...TEMPLATES[tsel.value] }; render(); });
    out.push(h('div.rowv', {}, h('label', {}, 'Template'), tsel));
    for (const [k, v0] of Object.entries(TEMPLATES[wd.model.template] || {})) {
      const v = wd.model[k] ?? v0;
      if (typeof v0 === 'number') out.push(h('div.rowv', {}, h('label', {}, k), well({ value: +v, min: 0, max: 200, step: k === 'pins' || k === 'rows' ? 1 : 0.1, int: k === 'pins' || k === 'rows', onChange: x => { wd.model[k] = x; } }).el));
      else {
        const inp = stop(h('input.txt', { type: 'text', value: String(v), style: { width: '140px' }, 'aria-label': k }));
        inp.addEventListener('change', () => { wd.model[k] = inp.value; });
        out.push(h('div.rowv', {}, h('label', {}, k), inp));
      }
    }
    return out;
  }
  function slotBlock() {
    const mats = C.materialList();
    const out = wd.slots.map((s, i) => {
      const key = stop(h('input.txt', { type: 'text', value: s.key, style: { width: '70px' }, 'aria-label': 'Slot key' }));
      key.addEventListener('change', () => { s.key = key.value.trim() || s.key; });
      const label = stop(h('input.txt', { type: 'text', value: s.label, 'aria-label': 'Slot label' }));
      label.addEventListener('change', () => { s.label = label.value; });
      const m = h('select.sq.sel', { 'aria-label': 'Default material' }, ...mats.map(x => h('option', { value: x.id }, x.name || x.id)));
      m.value = s.default;
      m.addEventListener('change', () => { s.default = m.value; });
      return h('div.slotrow', { style: { gridTemplateColumns: '70px 1fr 110px 26px' } }, key, label, m, btn('×', { cls: 'tiny', onClick: () => { wd.slots.splice(i, 1); render(); } }));
    });
    out.push(btn('Add slot', { cls: 'small', onClick: () => { wd.slots.push({ key: 'slot' + (wd.slots.length + 1), label: 'Slot', default: 'abs-white' }); render(); } }));
    return out;
  }
  function pinSelect(cur, onPick, allowInternal = false) {
    const opts = wd.pins.map(p => p.name);
    const s = h('select.sq.sel', { 'aria-label': 'Pin' }, ...opts.map(n => h('option', { value: n }, n)), allowInternal ? h('option', { value: '#n1' }, '#n1 (internal)') : null, allowInternal ? h('option', { value: '#n2' }, '#n2 (internal)') : null);
    if (cur && !opts.includes(cur) && cur.startsWith && cur.startsWith('#')) s.appendChild(h('option', { value: cur }, cur + ' (internal)'));
    s.value = cur || opts[0] || '';
    s.addEventListener('change', () => onPick(s.value));
    return s;
  }
  function paramRows(el) {
    const out = [];
    for (const [k, v] of Object.entries(el.params || {})) {
      if (typeof v === 'object') continue;
      const inp = stop(h('input.txt', { type: 'text', value: String(v), style: { width: '120px' }, 'aria-label': k }));
      inp.addEventListener('change', () => { const n = Number(inp.value); el.params[k] = inp.value === 'true' ? true : inp.value === 'false' ? false : Number.isFinite(n) && inp.value.trim() !== '' ? n : inp.value; });
      out.push(h('div.rowv', {}, h('label', {}, k), inp));
    }
    return out;
  }
  function elementBlock(el, types, allowInternal) {
    const tsel = h('select.sq.sel', { 'aria-label': 'Element type' }, ...types.map(t => h('option', { value: t }, t)));
    tsel.value = el.type;
    tsel.addEventListener('change', () => {
      const [terms, params] = ELEMENTS[tsel.value];
      el.type = tsel.value; el.params = clone(params);
      el.nodes = Object.fromEntries(terms.map((t, i) => [t, (wd.pins[i] || wd.pins[0] || { name: '1' }).name]));
      render();
    });
    const rows = [h('div.rowv', {}, h('label', {}, 'Element'), tsel)];
    for (const t of (ELEMENTS[el.type] || [[]])[0]) rows.push(h('div.rowv', {}, h('label', {}, `terminal ${t}`), pinSelect(el.nodes[t], v => { el.nodes[t] = v; }, allowInternal)));
    rows.push(...paramRows(el));
    return rows;
  }
  function electricalBlock() {
    const out = [];
    const ms = seg([{ value: 'none', label: 'NONE' }, { value: 'builtin', label: 'BUILT-IN' }, { value: 'subcircuit', label: 'SUBCIRCUIT' }, { value: 'logic', label: 'LOGIC' }], mode, v => {
      mode = v;
      const p = n => (wd.pins[n] || wd.pins[0] || { name: '1' }).name;
      if (v === 'none') wd.electrical = [];
      if (v === 'builtin' && (wd.electrical.length !== 1 || wd.electrical[0].type === 'logic-expr')) wd.electrical = [{ id: 'main', type: 'resistor', nodes: { a: p(0), b: p(1) }, params: { r: 1000 } }];
      if (v === 'subcircuit' && wd.electrical.length < 2) wd.electrical = [{ id: 'r1', type: 'resistor', nodes: { a: p(0), b: '#n1' }, params: { r: 1000 } }, { id: 'd1', type: 'led', nodes: { a: '#n1', k: p(1) }, params: { color: 'red' } }];
      if (v === 'logic') {
        const names = wd.pins.map(q => q.name);
        wd.electrical = [{ id: 'main', type: 'logic-expr', nodes: Object.fromEntries(names.map(n => [n, n])), params: { inputs: names.slice(0, Math.max(0, names.length - 3)), outputs: { [names[names.length - 3] || 'Y']: '!(' + (names[0] || 'A') + ' & ' + (names[1] || 'B') + ')' }, vcc: names[names.length - 2], gnd: names[names.length - 1] } }];
      }
      render();
    });
    out.push(ms.el);
    if (mode === 'none') out.push(note('The part has no circuit: it shows up and wires to nothing.'));
    if (mode === 'builtin') out.push(...elementBlock(wd.electrical[0], Object.keys(ELEMENTS), false));
    if (mode === 'subcircuit') {
      wd.electrical.forEach((el, i) => {
        out.push(h('div.sec', {}, h('span', {}, `element ${el.id}`), btn('×', { cls: 'tiny', onClick: () => { wd.electrical.splice(i, 1); render(); } })));
        out.push(...elementBlock(el, PRIMITIVES, true));
      });
      out.push(btn('Add element', { cls: 'small', onClick: () => { const n = wd.electrical.length + 1; wd.electrical.push({ id: 'e' + n, type: 'resistor', nodes: { a: wd.pins[0].name, b: '#n' + n }, params: { r: 1000 } }); render(); } }));
      out.push(note('A terminal can go to a pin or to an internal node (#n1, #n2): internal nodes join elements inside the part.'));
    }
    if (mode === 'logic') {
      const el = wd.electrical[0];
      const P2 = el.params;
      const names = wd.pins.map(q => q.name);
      out.push(h('div.rowv', {}, h('label', {}, 'VCC pin'), pinSelect(P2.vcc, v => { P2.vcc = v; })), h('div.rowv', {}, h('label', {}, 'GND pin'), pinSelect(P2.gnd, v => { P2.gnd = v; })));
      const ins = stop(h('input.txt', { type: 'text', value: (P2.inputs || []).join(', '), 'aria-label': 'Input pins' }));
      ins.addEventListener('change', () => { P2.inputs = ins.value.split(',').map(s => s.trim()).filter(s => names.includes(s)); });
      out.push(h('div.rowv', {}, h('label', {}, 'Inputs'), ins));
      for (const [pin, ex] of Object.entries(P2.outputs || {})) {
        const e = stop(h('input.txt.mono', { type: 'text', value: ex, 'aria-label': `Output ${pin}` }));
        e.addEventListener('change', () => { P2.outputs[pin] = e.value; });
        out.push(h('div.rowv', {}, h('label', {}, `${pin} =`), e));
      }
      const add = pinSelect(null, v => { if (!P2.outputs[v]) { P2.outputs[v] = '0'; render(); } });
      out.push(h('div.rowv', {}, h('label', {}, 'Add output'), add));
      out.push(note('Use pin names with ! & | ^ and ( ). For example Q = !(A & B). The chip reads inputs against its own VCC, like a 74HC part.'));
    }
    return out;
  }

  function render() {
    renderList();
    form.innerHTML = '';
    if (!wd) { form.append(note('Pick a custom part, or make a new one.')); return; }
    const name = stop(h('input.txt', { type: 'text', value: wd.name, 'aria-label': 'Part name' }));
    name.addEventListener('change', () => { wd.name = name.value; });
    const cat = h('select.sq.sel', { 'aria-label': 'Category' }, ...CATS.map(c => h('option', { value: c }, c)));
    cat.value = wd.category;
    cat.addEventListener('change', () => { wd.category = cat.value; });
    const mount = seg([{ value: 'board', label: 'BOARD' }, { value: 'free', label: 'MAT' }, { value: 'either', label: 'EITHER' }], wd.mount, v => { wd.mount = v; });
    const desc = stop(h('textarea.txt', { rows: 2, 'aria-label': 'Description', placeholder: 'What it is, what it does' }, wd.desc || ''));
    desc.addEventListener('change', () => { wd.desc = desc.value; });
    const grid = h('canvas.pe-grid', { 'aria-label': 'Pin grid: click to add a pin' });
    grid.addEventListener('click', e => {
      const r = grid.getBoundingClientRect(), s = r.width / (GRID + 1), o = s / 2 + (GRID / 2) * s;
      const gx = Math.round((e.clientX - r.left - o) / s), gz = Math.round((e.clientY - r.top - o) / s);
      const hit = wd.pins.findIndex(p => +p.x === gx && +p.z === gz);
      if (hit >= 0) selPin = hit;
      else {
        let n = wd.pins.length + 1; while (wd.pins.some(p => p.name === String(n))) n++;
        wd.pins.push({ name: String(n), x: gx, z: gz }); selPin = wd.pins.length - 1;
      }
      render();
    });
    form.append(sec(isNew ? 'New part' : 'Edit part', wd.id), name, h('div.rowv', {}, h('label', {}, 'Category'), cat), mount.el, h('div', { style: { height: '6px' } }), desc,
      sec('Pins', `${wd.pins.length} · 0.1 in grid`), grid, pinRows(),
      sec('3D model'), ...modelBlock(), sec('Material slots'), ...slotBlock(), sec('Electrical'), ...electricalBlock());
    if (errors.length) form.append(h('ul.errs', {}, ...errors.map(e => h('li.sq', {}, e))));
    form.append(sec('Save'), h('div.grid2', {},
      btn('Save', { cls: 'small.primary', title: 'Into this bench and the library panel', onClick: () => save(false) }),
      btn('Save to library', { cls: 'small', title: 'Also keep it in this browser', onClick: () => save(true) }),
      btn('Place', { cls: 'small', title: 'Save, then place one on the bench', onClick: () => { save(false); if (!errors.length) C.view.beginPlace(wd.id, {}); } }),
      btn('Export JSON', { cls: 'small', onClick: () => C.download(`${wd.name.replace(/\W+/g, '-')}.part.json`, JSON.stringify({ kind: 'part', def: buildDef() }, null, 1)) }),
      btn('Delete', { cls: 'small.warn', title: 'Remove from this bench (and the library)', onClick: () => {
        const id = wd.id;
        if (C.store.doc.parts.some(p => p.def === id)) { C.toast('warn', 'Parts of this kind are still on the bench. Remove them first.'); return; }
        if ((C.store.doc.customParts || []).some(d => d.id === id)) C.store.apply({ op: 'remove', ids: [id] });
        C.files.removeLibPart(id);
        try { C.registry.remove && C.registry.remove(id); } catch (e) { /* ignore */ }
        wd = null; C.refresh('registry'); render();
      } })));
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => drawGrid(grid)); else drawGrid(grid);
  }
  render();
  return {
    key: 'parts', title: 'PARTS', icon: 'parts', col: 'right', el: P.el, render,
    editDef(def) { edit(def, false); }, importDef(def) { const d = clone(def); if (!/^cp-/.test(d.id || '')) d.id = C.newId('customPart'); d.category = d.category || 'custom'; edit(d, true); C.toast('info', 'Imported: check it, then Save.'); },
    update(reason) { if (reason === 'doc') renderList(); }
  };
}
