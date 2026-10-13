// ============================================================================
//  BREADBOARD LAB  ·  ui/materials.js — the MATERIALS panel ("add materials")
// ----------------------------------------------------------------------------
//  The material editor in the style of the SDF lab MATERIAL rows (CONTRACT
//  1.4): colour, roughness, metalness, clearcoat, transmission, IOR,
//  emissive, opacity and a surface pattern (none, brushed, knurl, pcb,
//  grain, bumps). Presets are read-only; DUPLICATE makes an editable copy
//  in the document (id 'mat-…'), so a shared link carries it. SAVE TO
//  LIBRARY keeps a copy in this browser for other benches.
//
//  A TARGET is a part slot (from INSPECT's material button, or the selected
//  part): APPLY gives the slot this material; APPLY TO ALL gives that slot
//  of every part of the same kind. Edits of a custom material are store ops
//  on the material item, so they undo, and a scrub is one undo step.
//
//  The preview is view.previewMaterial(spec, size): one shared offscreen
//  render of a sphere and a pin (CONTRACT 4.2), redrawn at most every
//  120 ms while a well scrubs.
//
//  GREP MAP
//    FIELDS ............. the editable fields: key, label, kind, range
//    createMaterials .... the panel: grid, editor, target, library
//    allMaterials ....... presets + document + local library
//    preview ............ the throttled preview render
// ============================================================================
import { h, makePanel, btn, seg, well, sec, note } from './panels.js';

const PATTERNS = ['none', 'brushed', 'knurl', 'pcb', 'grain', 'bumps'];
const FIELDS = [
  ['roughness', 'Roughness', 0, 1, 0.01], ['metalness', 'Metalness', 0, 1, 0.01],
  ['clearcoat', 'Clearcoat', 0, 1, 0.01], ['clearcoatRoughness', 'Coat rough', 0, 1, 0.01],
  ['transmission', 'Transmission', 0, 1, 0.01], ['ior', 'IOR', 1, 2.5, 0.01], ['thickness', 'Thickness mm', 0, 10, 0.1],
  ['opacity', 'Opacity', 0, 1, 0.01], ['emissiveIntensity', 'Glow', 0, 10, 0.05], ['patternScale', 'Pattern scale', 0.25, 16, 0.05]
];
// a material without the panel's bookkeeping field
const strip = m => { const o = { ...m }; delete o._src; return o; };
const DEFAULTS = { clearcoat: 0, clearcoatRoughness: 0.3, transmission: 0, ior: 1.5, thickness: 1, opacity: 1, emissive: '#000000', emissiveIntensity: 0, pattern: 'none', patternScale: 1 };

export function createMaterials(C) {
  const P = makePanel({ id: 'p-materials', title: 'Materials', onClose: () => C.panels.close('materials') });
  let curId = null, target = null, previewT = 0, previewPending = null;
  const grid = h('div.mats');
  const canvas = h('canvas.mat-preview', { width: 320, height: 160, 'aria-label': 'Material preview' });
  const editor = h('div');
  const targetBox = h('div');
  P.body.append(targetBox, sec('Materials'), grid, canvas, editor);

  const presets = () => (C.materials && C.materials.MATERIAL_PRESETS) || [];
  function allMaterials() {
    const seen = new Set(), out = [];
    for (const m of [...presets().map(m => ({ ...m, _src: 'preset' })), ...(C.store.doc.materials || []).map(m => ({ ...m, _src: 'doc' })), ...C.files.libMaterials().map(m => ({ ...m, _src: 'lib' }))]) {
      if (seen.has(m.id)) continue; seen.add(m.id); out.push(m);
    }
    return out;
  }
  const find = id => allMaterials().find(m => m.id === id) || null;
  const isMetal = m => (m.metalness || 0) > 0.5;

  function preview(spec) {
    const now = performance.now();
    const draw = () => {
      previewT = performance.now(); previewPending = null;
      const g = canvas.getContext('2d');
      const w = canvas.width = Math.round((canvas.clientWidth || 320) * Math.min(2, devicePixelRatio || 1));
      const hh = canvas.height = Math.round(w / 2);
      g.fillStyle = '#0b0c0e'; g.fillRect(0, 0, w, hh);
      let img = null;
      try { img = C.view.previewMaterial ? C.view.previewMaterial(spec, hh) : null; } catch (e) { img = null; }
      if (img) g.drawImage(img, (w - img.width * (hh / img.height)) / 2, 0, img.width * (hh / img.height), hh);
      else {
        // no 3D preview: a lit disc in the base colour
        const r = hh * 0.38, cx = w / 2, cy = hh / 2;
        const gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
        gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.15 + (spec.roughness || 0) * 0.4, spec.color); gr.addColorStop(1, '#000000');
        g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = 'rgba(255,255,255,.6)'; g.font = `500 ${Math.round(hh * 0.08)}px system-ui, sans-serif`;
      g.fillText(spec.name || spec.id, hh * 0.06, hh * 0.12);
    };
    if (now - previewT > 120) draw();
    else if (!previewPending) previewPending = setTimeout(draw, 120);
  }

  function setField(m, key, value, meta) {
    if (m._src !== 'doc') return;
    C.store.apply({ op: 'set', id: m.id, path: key, value }, meta && meta.merge ? { merge: meta.merge } : undefined);
  }
  function duplicate(m) {
    const id = C.newId('material');
    const copy = { ...DEFAULTS, ...strip(m), id, name: (m.name || m.id) + ' copy' };
    C.store.apply({ op: 'add', kind: 'material', item: copy });
    curId = id; render();
    return copy;
  }
  function apply(all) {
    if (!target || !curId) return;
    const doc = C.store.doc, part = doc.parts.find(p => p.id === target.partId);
    if (!part) { C.toast('warn', 'The target part is gone.'); return; }
    const ids = all ? doc.parts.filter(p => p.def === part.def).map(p => p.id) : [part.id];
    C.store.apply({ op: 'batch', ops: ids.map(id => ({ op: 'set', id, path: 'looks.' + target.slot, value: curId })) });
    C.toast('info', `${find(curId)?.name || curId} on ${ids.length} part${ids.length === 1 ? '' : 's'} (${target.slot}).`);
  }

  function renderTarget() {
    targetBox.innerHTML = '';
    const sel = C.sel.length === 1 ? C.store.doc.parts.find(p => p.id === C.sel[0]) : null;
    if (!target && sel) { const def = C.defOf(sel.def); if (def && def.slots && def.slots.length) target = { partId: sel.id, slot: def.slots[0].key }; }
    const part = target && C.store.doc.parts.find(p => p.id === target.partId);
    if (!part) { target = null; targetBox.append(note('Select a part to give it a material, or edit a material for the library.')); return; }
    const def = C.defOf(part.def);
    const slotSel = h('select.sq.sel', { 'aria-label': 'Slot' }, ...(def ? def.slots || [] : []).map(s => h('option', { value: s.key }, s.label)));
    slotSel.value = target.slot;
    slotSel.addEventListener('change', () => { target.slot = slotSel.value; render(); });
    const cur = (part.looks && part.looks[target.slot]) || (def && (def.slots || []).find(s => s.key === target.slot)?.default);
    targetBox.append(sec('Target'), h('div.rowv', {}, h('label', {}, `${part.label || (def ? def.name : part.def)}`), slotSel),
      note(`Now: ${find(cur)?.name || cur || '—'}`),
      h('div.grid2', {}, btn('Apply', { cls: 'small.primary', title: 'This slot of this part', onClick: () => apply(false) }), btn('Apply to all', { cls: 'small', title: `This slot of every ${def ? def.name : part.def}`, onClick: () => apply(true) })));
  }
  function renderGrid() {
    grid.innerHTML = '';
    for (const m of allMaterials()) {
      const b = h('button.sq.mat', { type: 'button', title: `${m.name || m.id}${m._src === 'preset' ? ' (preset)' : m._src === 'lib' ? ' (library)' : ''}`, class: m.id === curId ? 'on' : null },
        h(`span.sw${isMetal(m) ? '.metal' : ''}`, { style: { '--c': m.color } }), h('span', {}, m.name || m.id));
      b.addEventListener('click', () => { curId = m.id; render(); });
      grid.appendChild(b);
    }
  }
  function renderEditor() {
    editor.innerHTML = '';
    const m = curId && find(curId);
    if (!m) { editor.append(note('Pick a material to see and edit it.')); return; }
    preview(m);
    const ro = m._src !== 'doc';
    if (ro) editor.append(note(m._src === 'preset' ? 'A preset: duplicate it to change it.' : 'In your local library: duplicate it into this bench to change it.'));
    const name = h('input.txt', { type: 'text', value: m.name || '', 'aria-label': 'Name', disabled: ro });
    name.addEventListener('keydown', e => e.stopPropagation());
    name.addEventListener('change', () => setField(m, 'name', name.value));
    const color = h('input.colorin', { type: 'color', value: m.color || '#888888', 'aria-label': 'Colour', disabled: ro });
    color.addEventListener('input', () => { setField(m, 'color', color.value, { merge: 'mat-color-' + m.id }); preview({ ...m, color: color.value }); });
    const emis = h('input.colorin', { type: 'color', value: m.emissive || '#000000', 'aria-label': 'Glow colour', disabled: ro });
    emis.addEventListener('input', () => setField(m, 'emissive', emis.value, { merge: 'mat-emis-' + m.id }));
    editor.append(sec('Look'), name, h('div.rowv', {}, h('label', {}, 'Colour'), color), h('div.rowv', {}, h('label', {}, 'Glow colour'), emis));
    for (const [key, label, min, max, step] of FIELDS) {
      const v = m[key] ?? DEFAULTS[key] ?? 0;
      const w = well({ value: v, min, max, step, format: x => x.toFixed(step < 0.1 ? 2 : 1), onChange: (x, meta) => { setField(m, key, x, meta); preview({ ...find(curId) }); } });
      if (ro) w.el.style.pointerEvents = 'none';
      editor.append(h('div.rowv', {}, h('label', {}, label), w.el));
    }
    const pat = seg(PATTERNS.map(p => ({ value: p, label: p === 'none' ? '—' : p.slice(0, 5).toUpperCase(), title: p })), m.pattern || 'none', v => setField(m, 'pattern', v));
    if (ro) pat.el.style.pointerEvents = 'none';
    editor.append(sec('Surface'), pat.el);
    const acts = h('div.grid2');
    acts.append(btn('Duplicate', { cls: 'small', title: 'An editable copy in this bench', onClick: () => duplicate(m) }));
    if (m._src === 'doc') {
      acts.append(btn('Save to library', { cls: 'small', title: 'Keep it in this browser for other benches', onClick: () => { const ok = C.files.saveLibMaterial(strip(m)); C.toast('info', ok ? 'Saved to your material library.' : 'Saved for this visit only (storage is blocked).'); render(); } }));
      acts.append(btn('Export JSON', { cls: 'small', onClick: () => C.download(`${(m.name || m.id).replace(/\W+/g, '-')}.material.json`, JSON.stringify({ kind: 'material', spec: strip(m) }, null, 1)) }));
      acts.append(btn('Delete', { cls: 'small.warn', title: 'Remove it from this bench (parts fall back to their default)', onClick: () => { C.store.apply({ op: 'remove', ids: [m.id] }); curId = null; render(); } }));
    }
    if (m._src === 'lib') acts.append(btn('Remove from library', { cls: 'small.warn', onClick: () => { C.files.removeLibMaterial(m.id); curId = null; render(); } }));
    acts.append(btn('Import JSON', { cls: 'small', onClick: () => C.importFile() }));
    editor.append(sec('Actions'), acts);
    const errs = C.materials && C.materials.validateMaterial ? C.materials.validateMaterial(strip(m)) : [];
    if (errs && errs.length) editor.append(h('ul.errs', {}, ...errs.map(e => h('li.sq.w', {}, e))));
  }
  function render() { renderTarget(); renderGrid(); renderEditor(); }
  render();
  return {
    key: 'materials', title: 'MATERIALS', icon: 'mat', col: 'right', el: P.el, render,
    setTarget(t) { target = t; const part = C.store.doc.parts.find(p => p.id === t.partId); if (part) curId = (part.looks && part.looks[t.slot]) || (C.defOf(part.def)?.slots || []).find(s => s.key === t.slot)?.default || curId; render(); },
    update(reason) {
      if (reason !== 'doc' && reason !== 'select') return;
      // a well or a colour picker in use: refresh the swatches only (a rebuild would drop the drag)
      const busy = P.el.querySelector('.num.hot') || (document.activeElement && P.el.contains(document.activeElement) && document.activeElement.type === 'color');
      if (busy && reason === 'doc') { renderGrid(); return; }
      render();
    }
  };
}
