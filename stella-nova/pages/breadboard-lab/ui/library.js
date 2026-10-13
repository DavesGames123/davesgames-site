// ============================================================================
//  BREADBOARD LAB  ·  ui/library.js — the LIBRARY panel
// ----------------------------------------------------------------------------
//  Boards, instruments and every part of the registry (built-in and custom),
//  by category, with a search over names, tags and descriptions.
//
//  TWO WAYS TO PLACE (CONTRACT 1.1, 4.2):
//    drag ... press a card and drag it out over the bench: once the pointer
//             leaves the panel, view.beginPlace(defId, params, event) takes
//             over the drag and shows the ghost.
//    tap .... tap a card (it lights up), then tap a hole: beginPlace without
//             an event arms the view for the next tap. place:end clears it.
//  Boards go in next to the others (store op), then they drag like a part.
//  Instruments call view.beginProbe(type) and then their leads.
//
//  GREP MAP
//    CAT_ICON ........... a schematic glyph per category
//    BOARD_CARDS / INSTR_CARDS
//    createLibraryPanel . the panel; render(), arm(), freeSpot()
// ============================================================================
import { h, makePanel, chip } from './panels.js';

const CAT_ICON = {
  boards: 'M3 7h18v10H3zM6 10h1M9 10h1M12 10h1M15 10h1M18 10h1M6 14h1M9 14h1M12 14h1M15 14h1M18 14h1',
  power: 'M4 12h4M8 7v10M12 9v6M16 7v10M20 12h-4',
  passive: 'M2 12h4l2-5 3 10 3-10 3 10 2-5h3',
  semis: 'M3 12h6M9 6v12l9-6zM18 6v12M18 12h3',
  ics: 'M7 4h10v16H7zM4 7h3M4 11h3M4 15h3M17 7h3M17 11h3M17 15h3',
  output: 'M12 3a6 6 0 0 1 3 11v3H9v-3a6 6 0 0 1 3-11zM9 21h6',
  input: 'M4 16h16M8 16v-6h8v6M12 10V6',
  sensors: 'M10 4a2 2 0 0 1 4 0v10a4 4 0 1 1-4 0z',
  mcu: 'M4 6h16v12H4zM7 9h4v4H7zM14 9h3M14 12h3M7 15h10',
  modules: 'M5 8h14v10H5zM9 8V4M15 8V4M8 12h8',
  instruments: 'M3 6h18v12H3zM6 15l3-5 3 3 3-6 3 8',
  custom: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z'
};
const CATS = [['all', 'ALL'], ['boards', 'BOARDS'], ['power', 'POWER'], ['passive', 'PASSIVE'], ['semis', 'SEMIS'], ['ics', 'ICs'], ['output', 'OUTPUT'], ['input', 'INPUT'], ['sensors', 'SENSORS'], ['mcu', 'MCU'], ['modules', 'MODULES'], ['instruments', 'METERS'], ['custom', 'CUSTOM']];
export const BOARD_CARDS = [
  { type: 'bb830', name: 'Full board · 830', desc: '63 columns, four rails' },
  { type: 'bb400', name: 'Half board · 400', desc: '30 columns, four rails' },
  { type: 'bb170', name: 'Mini board · 170', desc: '17 columns, no rails' }
];
export const INSTR_CARDS = [
  { type: 'dmm', name: 'Multimeter', desc: 'V, A in series, Ω, continuity' },
  { type: 'scope', name: 'Oscilloscope', desc: '2 or 4 channels, trigger, cursors' },
  { type: 'logic', name: 'Logic analyzer', desc: '8 channels, UART decode' }
];
const BOARD_SIZE = { bb830: [165.1, 54.6], bb400: [82.6, 54.6], bb170: [45.7, 34.5] };

function glyph(cat) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '20'); s.setAttribute('height', '20');
  s.setAttribute('class', 'g'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', CAT_ICON[cat] || CAT_ICON.custom);
  p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '1.7'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  s.appendChild(p);
  return s;
}

// C: the UI context (app.js)
export function createLibraryPanel(C) {
  const P = makePanel({ id: 'p-library', title: 'Library', cls: 'grow', onClose: () => C.panels.close('library') });
  let cat = 'all', q = '', armed = null;
  const search = h('input.txt.search', { type: 'search', placeholder: 'Search parts: led, 555, relay…', 'aria-label': 'Search parts' });
  search.addEventListener('input', () => { q = search.value.trim().toLowerCase(); render(); });
  search.addEventListener('keydown', e => e.stopPropagation());
  const cats = h('div.cats');
  const list = h('div');
  P.body.append(search, cats, list);
  for (const [k, label] of CATS) {
    const b = chip(label, { onClick: () => { cat = k; render(); } });
    b.dataset.k = k;
    cats.appendChild(b);
  }

  function defs() {
    let all = [];
    try { all = C.registry.list() || []; } catch (e) { all = []; }
    const seen = new Set(all.map(d => d.id));
    for (const d of (C.store.doc.customParts || [])) if (!seen.has(d.id)) { all.push(d); seen.add(d.id); }
    return all.filter(d => d.category !== 'instruments');
  }
  const match = (...txt) => !q || txt.join(' ').toLowerCase().includes(q);

  function card(key, title, desc, cat2, onActivate, onDrag, extraCls = '') {
    const b = h(`button.sq.card${extraCls}`, { type: 'button', title: desc, dataset: { k: key } }, glyph(cat2), h('span.n', {}, title), h('span.d', {}, desc));
    let down = null;
    b.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, id: e.pointerId, dragged: false };
    });
    b.addEventListener('pointermove', e => {
      if (!down || down.dragged || !onDrag) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) return;
      const pr = P.el.getBoundingClientRect();
      const out = e.clientX < pr.left || e.clientX > pr.right || e.clientY < pr.top || e.clientY > pr.bottom;
      if (!out && e.pointerType !== 'mouse') return;
      down.dragged = true;
      try { b.releasePointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      onDrag(e);
    });
    b.addEventListener('pointerup', () => { if (down && !down.dragged) onActivate(); down = null; });
    b.addEventListener('pointercancel', () => { down = null; });
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); } });
    if (armed === key) b.classList.add('armed');
    return b;
  }

  // a free spot for a new board: right of the boards on the bench
  function freeSpot(type) {
    const [w] = BOARD_SIZE[type];
    const bs = C.store.doc.boards || [];
    if (!bs.length) return { x: 0, z: 0 };
    let right = -Infinity, zAt = 0;
    for (const b of bs) { const bw = (BOARD_SIZE[b.type] || [80])[0] / 2; if (b.x + bw > right) { right = b.x + bw; zAt = b.z; } }
    return { x: +(right + 4 + w / 2).toFixed(2), z: zAt };
  }
  function addBoard(type) {
    const id = C.newId('board');
    const at = freeSpot(type);
    C.store.apply({ op: 'add', kind: 'board', item: { id, type, x: at.x, z: at.z, rot: 0 } });
    C.select([id]);
    C.toast('info', `Added a ${type === 'bb830' ? 'full' : type === 'bb400' ? 'half' : 'mini'} board. Drag it to move it; R turns it.`);
  }
  function arm(key, start) {
    armed = armed === key ? null : key;
    render();
    if (armed) { start(); C.hint(C.phone() ? 'Tap a hole to place it' : 'Click a hole to place it, or drag the card onto the bench. Esc cancels.'); }
    else C.cancelPlace();
  }
  function render() {
    for (const b of cats.children) b.classList.toggle('on', b.dataset.k === cat);
    list.innerHTML = '';
    const sections = [];
    if ((cat === 'all' || cat === 'boards')) {
      const cards = BOARD_CARDS.filter(b => match(b.name, b.desc, 'board breadboard', b.type)).map(b => card('board:' + b.type, b.name, b.desc, 'boards', () => addBoard(b.type), null));
      if (cards.length) sections.push(['Boards', cards]);
    }
    if ((cat === 'all' || cat === 'instruments')) {
      const cards = INSTR_CARDS.filter(b => match(b.name, b.desc, 'instrument meter probe', b.type)).map(b => card('probe:' + b.type, b.name, b.desc, 'instruments',
        () => arm('probe:' + b.type, () => C.view.beginProbe(b.type)),
        e => { armed = null; C.view.beginProbe(b.type, e); }));
      if (cards.length) sections.push(['Instruments', cards]);
    }
    const ds = defs().filter(d => (cat === 'all' || d.category === cat) && match(d.name, d.desc || '', (d.tags || []).join(' '), d.id));
    const byCat = new Map();
    for (const d of ds) { if (!byCat.has(d.category)) byCat.set(d.category, []); byCat.get(d.category).push(d); }
    for (const [k, label] of CATS) {
      const L = byCat.get(k);
      if (!L || !L.length) continue;
      sections.push([label, L.map(d => card('part:' + d.id, d.name, (d.desc || '').split('. ')[0], d.category,
        () => arm('part:' + d.id, () => C.view.beginPlace(d.id, {})),
        e => { armed = null; render(); C.view.beginPlace(d.id, {}, e); }, d.category === 'custom' ? '.custom' : ''))]);
    }
    if (!sections.length) { list.appendChild(h('p.empty', {}, q ? `Nothing matches "${q}".` : 'No parts in this group yet.')); return; }
    for (const [title, cards] of sections) {
      list.appendChild(h('div.sec', {}, h('span', {}, title), h('span.r', {}, String(cards.length))));
      list.appendChild(h('div.cards', {}, cards));
    }
  }
  C.bus.on('place:end', () => { if (armed) { armed = null; render(); C.hint(''); } });
  render();
  return { key: 'library', title: 'LIBRARY', icon: 'lib', col: 'left', el: P.el, render, update(reason) { if (reason === 'doc' || reason === 'registry') render(); }, clearArm() { if (armed) { armed = null; render(); } } };
}
