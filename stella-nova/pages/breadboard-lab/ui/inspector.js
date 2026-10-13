// ============================================================================
//  BREADBOARD LAB  ·  ui/inspector.js — the INSPECT panel
// ----------------------------------------------------------------------------
//  Shows the selection and edits it with store ops, so every change undoes.
//    part ..... label, description, damage (Replace part), every param of
//               its def as a value well (E12/E24 snapping for R and C),
//               material slots, live readings (current, power, temperature,
//               the voltage on each pin), rotate / duplicate / delete, and
//               "Open code" for a microcontroller
//    wire ..... colour, style, ends, the current through it
//    board .... type, split rails (830), rotate, delete
//    probe .... its leads; the instrument itself lives in #instrDock
//    nothing .. the bench title and notes
//  A scrub of a well is one undo step (the well's merge key). Live params
//  (pot position, light level) reach the running sim without a rebuild:
//  main.js sends sim.setParam for them.
//
//  The live block updates in place from frames (no rebuild), so a value well
//  that the user is dragging keeps its pointer capture.
//
//  GREP MAP
//    createInspector .... the panel; render() on selection or doc change
//    paramControl ....... def param -> well / seg / select / toggle / text
//    slotRows ........... material slots (one part, or every part of a kind)
//    liveBlock / frame .. readings from Frame.parts, nodeV, wires
//    actions ............ rotate, duplicate, delete, focus, repair, code
// ============================================================================
import { h, makePanel, btn, seg, toggle, well, sec, note } from './panels.js';
import { si } from './format.js';

export function findItem(doc, id) {
  for (const [kind, arr] of [['board', doc.boards], ['part', doc.parts], ['wire', doc.wires], ['probe', doc.probes], ['material', doc.materials], ['customPart', doc.customParts]]) {
    const it = (arr || []).find(x => x.id === id);
    if (it) return { kind, item: it };
  }
  return null;
}

export function createInspector(C) {
  const P = makePanel({ id: 'p-inspect', title: 'Inspect', onClose: () => C.panels.close('inspect') });
  let live = null;     // { update(frame) }
  let lastKey = '';

  function paramControl(part, def, p) {
    const val = part.params && part.params[p.key] !== undefined ? part.params[p.key] : p.default;
    const set = (v, meta) => C.store.apply({ op: 'set', id: part.id, path: 'params.' + p.key, value: v }, meta && meta.merge ? { merge: meta.merge } : undefined);
    if (p.type === 'bool') return toggle(p.label, !!val, v => set(v)).el;
    let ctl;
    if (p.type === 'enum') {
      const opts = (p.options || []).map(o => (typeof o === 'object' ? o : { value: o, label: String(o) }));
      if (opts.length <= 4 && opts.every(o => String(o.label).length <= 8)) ctl = seg(opts.map(o => ({ value: o.value, label: String(o.label).toUpperCase() })), val, v => set(v)).el;
      else {
        ctl = h('select.sq.sel', { 'aria-label': p.label }, ...opts.map(o => h('option', { value: String(o.value) }, String(o.label))));
        ctl.value = String(val);
        ctl.addEventListener('change', () => set(opts.find(o => String(o.value) === ctl.value)?.value ?? ctl.value));
      }
    } else if (p.type === 'string') {
      ctl = h('input.txt', { type: 'text', value: String(val ?? ''), 'aria-label': p.label, style: { width: '140px' } });
      ctl.addEventListener('keydown', e => e.stopPropagation());
      ctl.addEventListener('change', () => set(ctl.value));
    } else {
      const series = p.series || ((p.unit === 'Ω' || p.unit === 'F') && p.scale === 'log' ? 'E12' : null);
      ctl = well({
        value: Number(val), unit: p.unit && p.unit !== '' && p.unit !== '°C' && p.unit !== 'lux' && p.unit !== 'mAh' && p.unit !== '%' ? p.unit : '',
        min: p.min ?? -Infinity, max: p.max ?? Infinity, step: p.step, scale: p.scale || 'lin', series, int: p.type === 'int',
        format: (p.unit === '°C' || p.unit === 'lux' || p.unit === 'mAh' || p.unit === '%') ? (v => `${Number(v.toPrecision(4))} ${p.unit}`) : (!p.unit ? (v => (p.type === 'int' ? String(Math.round(v)) : Number(v.toPrecision(3)).toString())) : undefined),
        onChange: (v, meta) => set(v, meta)
      }).el;
    }
    return h('div.rowv', {}, h('label', { title: p.label }, p.label + (p.live ? ' ·' : '')), ctl);
  }

  function slotRows(part, def) {
    const out = [];
    const mats = C.materialList();
    for (const s of def.slots || []) {
      const cur = (part.looks && part.looks[s.key]) || s.default;
      const m = mats.find(x => x.id === cur);
      const sel = h('select.sq.sel', { 'aria-label': `${s.label} material` }, ...mats.map(x => h('option', { value: x.id }, x.name || x.id)));
      sel.value = cur;
      sel.addEventListener('change', () => C.store.apply({ op: 'set', id: part.id, path: 'looks.' + s.key, value: sel.value }));
      const edit = btn('', { cls: 'tiny', ico: 'mat', title: 'Edit materials for this slot', onClick: () => C.openMaterials({ partId: part.id, slot: s.key }) });
      out.push(h('div.slotrow', {}, h('label', { title: s.label }, h('i.dot', { style: { '--c': m ? m.color : '#888', display: 'inline-block', width: '10px', height: '10px', marginRight: '6px', verticalAlign: 'middle' } }), s.label), sel, edit));
    }
    if (out.length) {
      out.push(h('div.chips', {}, btn('Apply looks to every ' + def.name, {
        cls: 'chip', title: 'Give every part of this kind the same materials', onClick: () => {
          const ops = [];
          for (const q of C.store.doc.parts) if (q.def === part.def && q.id !== part.id) for (const s of def.slots || []) {
            const v = (part.looks && part.looks[s.key]) || s.default;
            ops.push({ op: 'set', id: q.id, path: 'looks.' + s.key, value: v });
          }
          if (ops.length) C.store.apply({ op: 'batch', ops });
          C.toast('info', ops.length ? `Copied the looks to ${new Set(ops.map(o => o.id)).size} parts.` : 'No other part of this kind on the bench.');
        }
      })));
    }
    return out;
  }

  function pinVolts(part, def) {
    const N = C.netlist, F = C.frame;
    if (!N || !F || !F.nodeV) return [];
    return (def.pins || []).map(pn => {
      const node = N.pinNode ? N.pinNode[part.id + '.' + pn.name] : undefined;
      return [pn.label || pn.name, node === null || node === undefined ? null : F.nodeV[node]];
    });
  }
  function liveBlock(id, kind, def) {
    const box = h('div.kv');
    const upd = () => {
      const F = C.frame;
      const rows = [];
      if (kind === 'part' && F && F.parts && F.parts[id]) {
        const s = F.parts[id];
        if (s.i !== undefined) rows.push(['I', si(s.i, 'A'), 'a']);
        if (s.p !== undefined) rows.push(['P', si(s.p, 'W'), '']);
        if (s.temp !== undefined) rows.push(['T', s.temp.toFixed(1) + ' °C', s.temp > 100 ? 'bad' : '']);
        if (s.vis) {
          if (s.vis.b !== undefined) rows.push(['glow', Math.round(s.vis.b * 100) + ' %', '']);
          if (s.vis.omega !== undefined) rows.push(['speed', (s.vis.omega * 60 / (2 * Math.PI)).toFixed(0) + ' rpm', '']);
          if (s.vis.angle !== undefined && def && def.visual === 'servo') rows.push(['angle', (s.vis.angle * 180 / Math.PI).toFixed(1) + '°', '']);
          if (s.vis.freq) rows.push(['freq', si(s.vis.freq, 'Hz'), '']);
          if (s.vis.soc !== undefined) rows.push(['charge', (s.vis.soc * 100).toFixed(0) + ' %', '']);
          if (s.vis.cc) rows.push(['mode', 'CC (current limit)', 'bad']);
        }
        if (def) for (const [name, v] of pinVolts(C.store.doc.parts.find(p => p.id === id) || { id }, def)) rows.push([name, v === null ? 'open' : si(v, 'V'), 'v']);
        const m = F.mcus && F.mcus[id];
        if (m) { rows.push(['sketch', m.error ? 'stopped' : m.running ? 'running' : 'idle', m.error ? 'bad' : '']); rows.push(['millis', String(m.millis), '']); }
      }
      if (kind === 'wire' && F && F.wires && C.netlist && C.netlist.wireIds) {
        const k = C.netlist.wireIds.indexOf(id);
        if (k >= 0) rows.push(['I', si(F.wires[k], 'A'), 'a']);
      }
      box.innerHTML = '';
      if (!rows.length) { box.appendChild(h('span.dim', {}, C.running ? 'no readings yet' : 'run the bench to see readings')); box.appendChild(h('b')); return; }
      for (const [k, v, c] of rows) { box.appendChild(h('span', {}, k)); box.appendChild(h(`b${c ? '.' + c : ''}`, {}, v)); }
    };
    upd();
    return { el: box, update: upd };
  }

  function actions(id, kind) {
    const row = h('div.grid3');
    if (kind === 'part' || kind === 'board') row.appendChild(btn('Rotate', { cls: 'small', title: 'Turn 90° (R)', onClick: () => C.rotate([id]) }));
    if (kind === 'part' || kind === 'board') row.appendChild(btn('Duplicate', { cls: 'small', title: 'Copy (Cmd/Ctrl+D)', onClick: () => C.duplicate([id]) }));
    if (kind !== 'material') row.appendChild(btn('Delete', { cls: 'small.warn', title: 'Remove (Delete)', onClick: () => C.remove([id]) }));
    if (kind === 'part' || kind === 'board') row.appendChild(btn('Focus', { cls: 'small', title: 'Frame it in the view (F)', onClick: () => C.view.focus && C.view.focus(id) }));
    return row;
  }

  function render(force = false) {
    const doc = C.store.doc, sel = C.sel;
    const key = sel.join(',') + '|' + (sel.length === 1 ? JSON.stringify(findItem(doc, sel[0])) : '');
    if (!force && key === lastKey) return;
    lastKey = key;
    const B = P.body;
    B.innerHTML = '';
    live = null;
    if (!sel.length) {
      P.setTitle('Inspect');
      const title = h('input.txt', { type: 'text', value: doc.title || '', 'aria-label': 'Bench title', placeholder: 'Untitled bench' });
      const notes = h('textarea.txt', { rows: 4, 'aria-label': 'Notes', placeholder: 'Notes about this bench' }, doc.notes || '');
      for (const el of [title, notes]) el.addEventListener('keydown', e => e.stopPropagation());
      title.addEventListener('change', () => C.store.apply({ op: 'meta', title: title.value }));
      notes.addEventListener('change', () => C.store.apply({ op: 'meta', notes: notes.value }));
      B.append(sec('Bench'), title, h('div', { style: { height: '6px' } }), notes,
        note(`${doc.boards.length} board${doc.boards.length === 1 ? '' : 's'}, ${doc.parts.length} part${doc.parts.length === 1 ? '' : 's'}, ${doc.wires.length} wire${doc.wires.length === 1 ? '' : 's'}.`),
        note(C.phone() ? 'Tap a part to inspect it. Long-press for rotate, delete and more.' : 'Click a part, a wire or a board to inspect it. Shift-click adds to the selection; drag on the mat with Shift to box-select.'));
      return;
    }
    if (sel.length > 1) {
      P.setTitle(`Inspect · ${sel.length}`);
      B.append(sec(`${sel.length} items`), h('div.grid3', {}, btn('Rotate', { cls: 'small', onClick: () => C.rotate(sel) }), btn('Duplicate', { cls: 'small', onClick: () => C.duplicate(sel) }), btn('Delete', { cls: 'small.warn', onClick: () => C.remove(sel) })));
      return;
    }
    const f = findItem(doc, sel[0]);
    if (!f) { B.append(note('The selected item is gone.')); return; }
    const { kind, item } = f;
    if (kind === 'part') {
      const def = C.defOf(item.def);
      P.setTitle(def ? def.name : item.def);
      const label = h('input.txt', { type: 'text', value: item.label || '', placeholder: def ? def.name : item.def, 'aria-label': 'Label' });
      label.addEventListener('keydown', e => e.stopPropagation());
      label.addEventListener('change', () => C.store.apply({ op: 'set', id: item.id, path: 'label', value: label.value || undefined }));
      const pf = C.frame && C.frame.parts && C.frame.parts[item.id];
      const head = h('div.insp-head', {}, h('div.nm', {}, label));
      if (pf && pf.damaged) head.appendChild(h('span.sq.badge', { title: 'This part is damaged' }, pf.damaged.toUpperCase()));
      if (def && def.category === 'modules') head.appendChild(h('span.sq.badge.ns', { title: 'Its electrical model is a supply load and 1 MΩ inputs' }, 'NOT SIMULATED'));
      B.append(head);
      if (pf && pf.damaged) B.append(btn('Replace part', { cls: 'wide.primary', title: 'Put in a new one (the damage goes away)', onClick: () => { C.sim.repair && C.sim.repair(item.id); C.toast('info', 'Replaced with a new part.'); } }));
      if (def && def.desc) B.append(h('p.insp-desc', {}, def.desc));
      if (!def) { B.append(note(`Unknown part "${item.def}". It is kept in the file but does nothing.`)); B.append(actions(item.id, kind)); return; }
      const ps = (def.params || []).filter(p => !p.hidden);
      if (ps.length) { B.append(sec('Values')); for (const p of ps) B.append(paramControl(item, def, p)); }
      if (C.isMcu(item.def)) {
        B.append(sec('Program'));
        const prog = doc.programs && doc.programs[item.id];
        B.append(note(prog ? `A ${prog.lang === 'hex' ? 'HEX program' : `sketch of ${prog.source.split('\n').length} lines`} is loaded.` : 'No sketch yet: the board idles with every pin an input.'));
        B.append(btn('Open code', { cls: 'wide.primary', ico: 'code', onClick: () => C.openCode(item.id) }));
      }
      live = liveBlock(item.id, 'part', def);
      B.append(sec('Live'), live.el);
      const rows = slotRows(item, def);
      if (rows.length) B.append(sec('Materials'), ...rows);
      B.append(sec('Actions'), actions(item.id, kind));
      return;
    }
    if (kind === 'wire') {
      P.setTitle('Wire');
      const sw = h('div.swatches', {}, ...C.WIRE_COLORS.map(c => {
        const b = h('button', { type: 'button', style: { '--c': c }, title: c, 'aria-label': 'Colour ' + c, class: c === item.color ? 'on' : null });
        b.addEventListener('click', () => C.store.apply({ op: 'set', id: item.id, path: 'color', value: c }));
        return b;
      }));
      const st = seg([{ value: 'arch', label: 'ARCH' }, { value: 'flat', label: 'FLAT' }, { value: 'free', label: 'FREE' }], item.style || 'arch', v => C.store.apply({ op: 'set', id: item.id, path: 'style', value: v }));
      live = liveBlock(item.id, 'wire');
      B.append(sec('Colour'), sw, sec('Style'), st.el, sec('Ends'), h('div.kv', {}, h('span', {}, 'A'), h('b', {}, C.describeEnd(item.a)), h('span', {}, 'B'), h('b', {}, C.describeEnd(item.b))), sec('Live'), live.el, sec('Actions'), actions(item.id, kind));
      return;
    }
    if (kind === 'board') {
      P.setTitle('Board ' + item.id);
      B.append(note({ bb830: 'Full board: 63 columns, rows a–j, four rails of 50.', bb400: 'Half board: 30 columns, four rails of 25.', bb170: 'Mini board: 17 columns, no rails.' }[item.type] || item.type));
      if (item.type === 'bb830') B.append(toggle('Split rails', !!(item.params && item.params.splitRails), v => C.store.apply({ op: 'set', id: item.id, path: 'params.splitRails', value: v })).el,
        note('Some 830 boards cut each rail in the middle. Then each half needs its own feed.'));
      B.append(sec('Actions'), actions(item.id, kind));
      return;
    }
    if (kind === 'probe') {
      P.setTitle({ dmm: 'Multimeter', scope: 'Oscilloscope', logic: 'Logic analyzer' }[item.type] || 'Instrument');
      B.append(sec('Leads'), h('div.kv', {}, ...Object.entries(item.leads || {}).flatMap(([k, e]) => [h('span', {}, k.toUpperCase()), h('b', {}, e ? C.describeEnd(e) : '—')])),
        note('Plug a lead: press its button on the instrument, then click a hole. Or drag the lead tip in 3D.'),
        btn('Show the instrument', { cls: 'wide', onClick: () => C.showInstrument(item.id) }), sec('Actions'), actions(item.id, kind));
    }
  }
  return {
    key: 'inspect', title: 'INSPECT', icon: 'inspect', col: 'right', el: P.el,
    render, update(reason) {
      if (reason === 'doc' && P.el.querySelector('.num.hot')) return;     // a scrub in progress keeps its well
      if (reason === 'doc' || reason === 'select' || reason === 'netlist') render(reason === 'netlist');
    },
    frame() { if (live) live.update(); if (C.sel.length === 1) { const pf = C.frame && C.frame.parts && C.frame.parts[C.sel[0]]; const dmg = !!(pf && pf.damaged); if (dmg !== !!P.el._dmg) { P.el._dmg = dmg; render(true); } } }
  };
}
