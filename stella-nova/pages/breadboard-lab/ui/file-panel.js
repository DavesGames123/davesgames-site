// ============================================================================
//  BREADBOARD LAB  ·  ui/file-panel.js — the FILE panel
// ----------------------------------------------------------------------------
//  Save and load by name (ui/files.js: localStorage, with a memory fallback
//  that says "for this visit only"), share by link (ui/share.js), export and
//  import JSON, and import the old 2D bench (ui/legacy.js) from a file or
//  from pasted text (the old page had a "copy design JSON" box). An import
//  that is approximate lists its warnings here.
//
//  The HEX upload of CONTRACT 6 step 2 is not built (mcu/avr.js is absent),
//  so this panel shows no HEX option.
//
//  GREP MAP
//    createFilePanel ... the panel: save, list, share, export, import, legacy
//    EMPTY_DOC ......... a new bench: one 830 board
// ============================================================================
import { h, makePanel, btn, sec, note } from './panels.js';
import { shareLink, LINK_WARN } from './share.js';
import { parseJSON, exportJSON, pickFile } from './files.js';
import { importLegacy } from './legacy.js';

export const EMPTY_DOC = () => ({
  format: 'breadboard-lab', version: 1, title: 'Untitled bench', notes: '',
  boards: [{ id: 'b1', type: 'bb830', x: 0, z: 0, rot: 0 }], parts: [], wires: [], probes: [],
  materials: [], customParts: [], programs: {}, sim: { speed: 1, pwm: 'auto' }, nextId: 2
});

export function createFilePanel(C) {
  const P = makePanel({ id: 'p-file', title: 'File', onClose: () => C.panels.close('file') });
  const stop = el => { el.addEventListener('keydown', e => e.stopPropagation()); return el; };
  const name = stop(h('input.txt', { type: 'text', placeholder: 'Name to save as', 'aria-label': 'Save name' }));
  const saved = h('div.issues');
  const shareOut = stop(h('input.txt.mono', { type: 'text', readonly: true, 'aria-label': 'Share link', placeholder: 'Make a link…' }));
  const shareNote = h('p.note');
  const warnBox = h('div');
  const paste = stop(h('textarea.txt.mono', { rows: 4, placeholder: 'Paste a bench JSON or the old bench "Design JSON" here', 'aria-label': 'Paste JSON' }));
  const persist = h('p.note');

  function doSave() {
    const n = name.value.trim() || C.store.doc.title || 'bench';
    const r = C.files.save(n, C.store.doc);
    if (!r.ok) { C.toast('warn', r.error); return; }
    C.toast('info', r.persisted ? `Saved "${n}".` : `Saved "${n}" for this visit only: this browser blocks storage.`);
    name.value = ''; renderList();
  }
  function renderList() {
    saved.innerHTML = '';
    const L = C.files.list();
    if (!L.length) saved.append(h('p.empty', {}, 'No saved benches yet.'));
    for (const f of L) {
      const row = h('div.sq.issue.info', {}, h('i'), h('span', {}, f.name, h('small', {}, `${new Date(f.t).toLocaleString()} · ${f.parts} parts`)));
      const acts = h('div.grid2', { style: { marginBottom: '4px' } },
        btn('Load', { cls: 'small', onClick: () => { const d = C.files.load(f.name); if (d) C.loadDoc(d); } }),
        btn('Delete', { cls: 'small.warn', onClick: () => { C.files.remove(f.name); renderList(); } }));
      saved.append(row, acts);
    }
    persist.textContent = C.files.storage.persistent ? 'Saves stay in this browser. The bench also autosaves.' : 'This browser blocks storage: saves last for this visit only. Use a link or a JSON file to keep work.';
  }
  async function doShare() {
    try {
      const L = await shareLink(C.store.doc);
      shareOut.value = L.url;
      let copied = false;
      try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(L.url); copied = true; } } catch (e) { copied = false; }
      shareNote.textContent = `${L.chars} characters${copied ? ', copied' : ''}.` + (L.warn ? ` Over ${LINK_WARN}: some apps cut long links. Send the JSON file instead.` : '');
      shareNote.style.color = L.warn ? 'var(--warn)' : '';
      shareOut.select();
    } catch (e) { C.toast('error', 'Could not make the link: ' + e.message); }
  }
  function importText(text, src = 'file') {
    const r = parseJSON(text);
    warnBox.innerHTML = '';
    if (r.kind === 'doc' || r.kind === 'example') { C.loadDoc(r.doc); C.toast('info', `Loaded the bench from the ${src}.`); return; }
    if (r.kind === 'legacy') {
      try {
        const { doc, warnings } = importLegacy(r.legacy, { registry: C.registry });
        C.loadDoc(doc);
        C.toast(warnings.length ? 'warn' : 'info', `Imported the old bench: ${doc.parts.length} parts, ${doc.wires.length} wires${warnings.length ? `, ${warnings.length} notes` : ''}.`);
        if (warnings.length) warnBox.append(sec('Import notes', String(warnings.length)), h('ul.errs', {}, ...warnings.map(w => h('li.sq.w', {}, w))));
      } catch (e) { C.toast('error', e.message); }
      return;
    }
    if (r.kind === 'part') { C.importPart(r.def); return; }
    if (r.kind === 'material') {
      const spec = { ...r.spec, id: /^mat-/.test(r.spec.id || '') && !(C.store.doc.materials || []).some(m => m.id === r.spec.id) ? r.spec.id : C.newId('material') };
      const errs = C.materials && C.materials.validateMaterial ? C.materials.validateMaterial(spec) : [];
      if (errs.length) { C.toast('warn', 'That material has problems: ' + errs.join('; ')); return; }
      C.store.apply({ op: 'add', kind: 'material', item: spec });
      C.toast('info', `Added the material "${spec.name || spec.id}".`);
      return;
    }
    C.toast('error', r.error || 'Unknown file.');
  }
  const pick = async () => { try { importText(await pickFile(), 'file'); } catch (e) { if (e.message !== 'no file') C.toast('error', e.message); } };

  P.body.append(
    sec('Save'), h('div.serial-in', { style: { gridTemplateColumns: '1fr auto' } }, name, btn('Save', { cls: 'small.primary', onClick: doSave })), persist, saved,
    sec('Share'), note('The link holds the whole bench, compressed. Anyone who opens it gets a copy.'), h('div.serial-in', { style: { gridTemplateColumns: '1fr auto' } }, shareOut, btn('Make link', { cls: 'small', ico: 'share', onClick: doShare })), shareNote,
    sec('Files'), h('div.grid2', {},
      btn('Export JSON', { cls: 'small', onClick: () => C.download(`${(C.store.doc.title || 'bench').replace(/\W+/g, '-')}.bench.json`, exportJSON(C.store.doc)) }),
      btn('Import JSON', { cls: 'small', title: 'A bench, an example, a part, a material, or an old bench file', onClick: pick }),
      btn('New bench', { cls: 'small', onClick: () => C.loadDoc(EMPTY_DOC()) }),
      btn('Old bench file', { cls: 'small', title: 'A JSON file saved by the old 2D breadboard bench', onClick: pick })),
    sec('Paste'), paste, h('div', { style: { height: '6px' } }), btn('Import pasted JSON', { cls: 'small.wide', onClick: () => { if (paste.value.trim()) importText(paste.value, 'pasted text'); } }),
    warnBox);
  renderList();
  return { key: 'file', title: 'FILE', icon: 'file', col: 'right', el: P.el, importText, pick, update(reason) { if (reason === 'open') renderList(); } };
}
