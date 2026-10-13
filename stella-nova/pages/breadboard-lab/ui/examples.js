// ============================================================================
//  BREADBOARD LAB  ·  ui/examples.js — the EXAMPLES panel
// ----------------------------------------------------------------------------
//  INTEGRATE passes the example index with ui.examples(list) (CONTRACT 4.4,
//  5). An entry may be { meta, doc }, a flat { key, title, level, blurb,
//  see, doc }, or { meta, load: async () => ({ meta, doc }) }.
//
//  Loading replaces the bench, so it asks first when the bench has parts
//  (an inline Load / Cancel, never a blocking dialog). After the load, the
//  panel shows "what you should see" for that example, and the toast says
//  the first point of it.
//
//  GREP MAP
//    normEntry ........ any entry shape -> { key, title, level, blurb, see, get() }
//    createExamples ... the panel; level filter, list, the current example card
// ============================================================================
import { h, makePanel, btn, chip, sec, note } from './panels.js';

export function normEntry(e) {
  const m = e.meta || e;
  const doc = e.doc || null;
  return {
    key: m.key, title: m.title || m.key, level: m.level || 1, blurb: m.blurb || '', see: m.see || [],
    get: async () => {
      if (doc) return { meta: m, doc };
      if (typeof e.load === 'function') { const r = await e.load(); return { meta: r.meta || m, doc: r.doc || r }; }
      throw new Error('this example has no document');
    }
  };
}

export function createExamples(C) {
  const P = makePanel({ id: 'p-examples', title: 'Examples', cls: 'grow', onClose: () => C.panels.close('examples') });
  let list = [], level = 0, current = null, asking = null;
  const levels = h('div.chips');
  const cardBox = h('div');
  const listBox = h('div.issues');
  P.body.append(cardBox, levels, listBox);
  for (const [v, label] of [[0, 'ALL'], [1, 'START'], [2, 'BUILD'], [3, 'DEEP']]) {
    const b = chip(label, { onClick: () => { level = v; render(); } }); b.dataset.v = String(v); levels.appendChild(b);
  }
  async function open(ex) {
    try {
      const { meta, doc } = await ex.get();
      C.loadDoc(doc, { example: meta.key });
      current = { ...ex, see: meta.see || ex.see };
      asking = null;
      C.toast('info', `${ex.title}: ${(current.see && current.see[0]) || ex.blurb}`);
      render();
      if (C.phone()) C.closeSheet();
    } catch (e) { C.toast('error', `Could not load ${ex.title}: ${e.message}`); }
  }
  function render() {
    for (const b of levels.children) b.classList.toggle('on', +b.dataset.v === level);
    cardBox.innerHTML = '';
    if (current) {
      cardBox.append(sec('On the bench'), h('div.sq.issue.info', {}, h('i'), h('span', {}, h('b', {}, current.title), h('small', {}, current.blurb))));
      if (current.see && current.see.length) cardBox.append(h('ul.errs', {}, ...current.see.map(s => h('li.sq.ok', {}, s))));
    }
    listBox.innerHTML = '';
    if (!list.length) { listBox.append(note('Examples load here when the page starts.')); return; }
    for (const ex of list.filter(x => !level || x.level === level)) {
      const row = h('button.sq.issue', { type: 'button', title: ex.blurb }, h('i', { style: { background: ['', 'var(--ok)', 'var(--warn)', 'var(--bad)'][ex.level] || 'var(--dim)' } }), h('span', {}, ex.title, h('small', {}, ex.blurb)));
      row.addEventListener('click', () => {
        const busy = (C.store.doc.parts || []).length > 0 && C.isDirty();
        if (busy && asking !== ex.key) { asking = ex.key; render(); return; }
        open(ex);
      });
      listBox.append(row);
      if (asking === ex.key) listBox.append(h('div.grid2', {}, btn('Load, replace my bench', { cls: 'small.primary', onClick: () => open(ex) }), btn('Cancel', { cls: 'small', onClick: () => { asking = null; render(); } })));
    }
  }
  render();
  return {
    key: 'examples', title: 'EXAMPLES', icon: 'examples', col: 'right', el: P.el,
    setList(L) { list = (L || []).map(normEntry).filter(e => e.key); render(); },
    setCurrent(key) { current = list.find(e => e.key === key) || null; render(); },
    update() {}
  };
}
