// ============================================================================
//  STELLA NOVA  ·  lib/sn-panel.js — the control panel of a sim page
// ----------------------------------------------------------------------------
//  One small API makes every control of a panel. A page declares sections
//  and controls; this module writes the markup, so all controls have one
//  look (lib/sn-panel.css) and the same accessibility rules:
//    - each control has a <label> or an aria-labelledby that names it
//    - a section head is a button with aria-expanded; the open state of
//      each section stays in localStorage (try/catch, a page works with no
//      storage)
//    - the DOM order is the visual order on every form (no CSS order), so
//      the keyboard order follows what the user sees
//  The user said "the options table is very vibecoded and we need it to be
//  much much cleaner" (2026-10-18). This module is the answer to that.
//
//  CONTROL VOCABULARY
//    segmented . 2 to 4 options in one row (a group of pressed buttons)
//    chips ..... 5 or more options in a grid of 2 or 3 columns
//    slider .... label at the left, value at the right (tabular numerals,
//                with a unit), the range under them
//    toggle .... a switch (checkbox with role switch), label at the left
//    select .... a native select, for a long list
//    button .... 'primary' (one per section at most) or 'secondary'
//    actions ... a row of 2 or 3 buttons of equal width
//    slot ...... an element that the page fills (a gradient picker)
//    note ...... one short line of muted text (a status, not a manual)
//  A control can have `hint`: a small info button shows the text under it.
//
//  USE
//    import { createPanel, icon, fillIcons, mountSheet } from '../../lib/sn-panel.js';
//    const panel = createPanel(el, { store: 'coral-reef' });
//    const s = panel.section({ id: 'look', title: 'Look', open: true });
//    s.segmented({ id: 'rovCount', label: 'Squad', items: [{ id: 2, label: '2' }], value: 2, onChange });
//    s.slider({ id: 'sCur', label: 'Current', min: 0, max: 1.5, step: 0.01, value: 0.5, format: v => v.toFixed(2), unit: 'm/s', onInput });
//    s.toggle({ id: 'tSnow', label: 'Marine snow', value: true, onChange });
//    panel.find('tSnow').set(false)       // set with no callback
//    panel.toggle({ section: 'look', ... }) is the same as s.toggle(...)
//
//  Every factory returns a control: { id, el (the row), input (the element
//  with the id), value, set(v, fire = false), on(v) }. Choice controls also
//  have setItems(items, value). The element with the given id is the input
//  (range, checkbox, select) or the group (segmented, chips, slot).
//
//  GREP MAP
//    grep -n 'export function createPanel'  sections and controls
//    grep -n 'function section'             one collapsible section
//    grep -n 'function choice'              segmented and chips
//    grep -n 'function slider'              the slider row
//    grep -n 'function toggle'              the switch row
//    grep -n 'export function mountSheet'   open, close, the phone sheet grip
//    grep -n 'export function sheetSnap'    the grip drag (no DOM)
//    grep -n 'export const ICONS'           the line icons (SVG)
//    grep -n 'export function fillIcons'    <i data-icon="name"> in static markup
// ============================================================================

// ── icons: 20 px line icons, stroke currentColor ────────────────────────────
const P = d => `<path d="${d}"/>`;
export const ICONS = {
  menu: P('M4 6h12M4 10h12M4 14h12'),
  close: P('M5 5l10 10M15 5L5 15'),
  chevron: P('M7 8l3 3 3-3'),
  info: '<circle cx="10" cy="10" r="7"/>' + P('M10 9v5M10 6.5v.01'),
  camera: '<rect x="3" y="6" width="10" height="8" rx="1.5"/>' + P('M13 9l4-2v6l-4-2'),
  feed: '<rect x="3" y="4" width="14" height="10" rx="1.5"/>' + P('M7 17h6M10 14v3'),
  palette: '<circle cx="10" cy="10" r="7"/>' + P('M10 3a7 7 0 0 0 0 14z'),
  dice: '<rect x="4" y="4" width="12" height="12" rx="2.5"/><circle cx="7.5" cy="7.5" r=".6"/><circle cx="12.5" cy="12.5" r=".6"/><circle cx="10" cy="10" r=".6"/>',
  play: P('M7 5l8 5-8 5z'),
  pause: P('M7 5v10M13 5v10'),
  regrow: P('M15 10a5 5 0 1 1-1.5-3.6M15 4v3h-3'),
  species: P('M10 17V9M10 9c0-3 2-5 5-5 0 3-2 5-5 5zM10 12c0-2.5-1.7-4-4-4 0 2.5 1.7 4 4 4z'),
  target: '<circle cx="10" cy="10" r="6"/><circle cx="10" cy="10" r="1.5"/>',
  orbit: '<ellipse cx="10" cy="10" rx="7" ry="3.5"/><circle cx="10" cy="10" r="1.5"/>',
  swim: P('M3 8c2-2 3-2 5 0s3 2 5 0 3-2 4-1M3 13c2-2 3-2 5 0s3 2 5 0 3-2 4-1'),
  route: '<circle cx="5" cy="15" r="1.5"/><circle cx="15" cy="5" r="1.5"/>' + P('M6.5 15H12a2.5 2.5 0 0 0 0-5H8a2.5 2.5 0 0 1 0-5h5.5'),
  expand: P('M12 4h4v4M8 16H4v-4M16 4l-5 5M4 16l5-5'),
};
export function icon(name, cls = 'snp-ic') {
  return `<svg class="${cls}" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
}
// Static markup names its icons: <i data-icon="camera"></i>. This fills them.
export function fillIcons(root) {
  for (const e of root.querySelectorAll('[data-icon]')) { e.innerHTML = icon(e.dataset.icon); e.setAttribute('aria-hidden', 'true'); }
}

// ── storage (try/catch: private windows and previews throw) ─────────────────
function store(key, v) {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    if (v === undefined) return ls.getItem(key);
    ls.setItem(key, v);
  } catch (e) { /* no storage */ }
  return null;
}

// ── the sheet grip: the state after a drag of dy px (down is positive) ─────
// A short drag (a tap) toggles half and full.
export function sheetSnap(state, dy) {
  if (Math.abs(dy) < 8) return state === 'full' ? 'half' : 'full';
  if (dy < -40) return 'full';
  if (dy > 40) return state === 'full' ? 'half' : 'closed';
  return state;
}

let uid = 0;
export function createPanel(root, { store: key = 'page', doc = root.ownerDocument } = {}) {
  const sections = new Map(), controls = new Map();
  const el = (tag, cls, attrs = {}) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
    return e;
  };
  const nid = p => `snp-${p}-${++uid}`;
  root.classList.add('snp-sections');

  // One collapsible section. open: the default; the stored state wins.
  function section({ id, title, open = true }) {
    if (sections.has(id)) return sections.get(id);
    const sec = el('section', 'snp-sec', { 'data-sec': id });
    const hid = nid('h'), bid = nid('b');
    const head = el('button', 'snp-head', { type: 'button', id: hid, 'aria-expanded': 'true', 'aria-controls': bid });
    head.innerHTML = `<span class="snp-title"></span>${icon('chevron', 'snp-ic snp-chev')}`;
    head.firstChild.textContent = title;
    const body = el('div', 'snp-body', { id: bid, role: 'region', 'aria-labelledby': hid });
    sec.append(head, body);
    root.appendChild(sec);
    const skey = `snp:${key}:${id}`;
    const stored = store(skey);
    const S = {
      id, el: sec, head, body,
      get open() { return !body.hidden; },
      setOpen(v, save = true) {
        body.hidden = !v; head.setAttribute('aria-expanded', String(!!v)); sec.classList.toggle('closed', !v);
        if (save) store(skey, v ? '1' : '0');
      },
    };
    S.setOpen(stored === null ? open : stored === '1', false);
    head.addEventListener('click', () => S.setOpen(!S.open));
    for (const k of Object.keys(factories)) S[k] = o => factories[k](S, o || {});
    sections.set(id, S);
    return S;
  }

  // A row in a section body; the label row has the label and, if any, the
  // value and the info button. hint: text under the control, shown by (i).
  function row(S, cls, o) {
    const r = el('div', `snp-row ${cls}`);
    if (o.hidden) r.hidden = true;
    S.body.appendChild(r);
    return r;
  }
  function addHint(r, lab, o) {
    if (!o.hint) return;
    const hid = nid('hint');
    const b = el('button', 'snp-info', { type: 'button', 'aria-label': `About ${o.label}`, 'aria-expanded': 'false', 'aria-controls': hid, title: o.hint });
    b.innerHTML = icon('info');
    const p = el('p', 'snp-hint', { id: hid });
    p.textContent = o.hint; p.hidden = true;
    b.addEventListener('click', () => { p.hidden = !p.hidden; b.setAttribute('aria-expanded', String(!p.hidden)); });
    lab.appendChild(b);
    r.appendChild(p);
  }
  function reg(S, c) {
    if (c.id) controls.set(String(c.id), c);
    return c;
  }

  // segmented (cols = items) and chips (a grid). Items: { id, label,
  // disabled, title, swatch }. value null: no item is on (action chips).
  function choice(S, o, kind) {
    const r = row(S, `snp-choice snp-${kind}`, o);
    const lid = nid('l');
    if (o.label) {
      const lab = el('div', 'snp-label', { id: lid });
      lab.appendChild(el('span', 'snp-ltext')).textContent = o.label;
      r.appendChild(lab);
      addHint(r, lab, o);
    }
    const g = el('div', kind === 'chips' ? 'snp-chips' : 'snp-seg', { role: 'group', id: o.id, 'aria-labelledby': o.label ? lid : null, 'aria-label': o.label ? null : o.aria || null });
    const hint = r.querySelector('.snp-hint');
    r.insertBefore(g, hint);
    const C = { id: o.id, el: r, input: g, value: o.value ?? null, kind };
    C.paint = () => {
      for (const b of g.children) {
        const on = C.value != null && String(b.dataset.id) === String(C.value);
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
      }
    };
    C.setItems = (items, value = C.value) => {
      g.innerHTML = '';
      C.items = items;
      if (kind === 'chips') g.style.setProperty('--cols', o.columns || (items.length > 6 ? 3 : 2));
      else g.style.setProperty('--cols', items.length);
      for (const it of items) {
        const b = el('button', 'snp-opt', { type: 'button', 'data-id': String(it.id), title: it.title || null });
        if (it.swatch) { const s = el('span', 'snp-sw', { 'aria-hidden': 'true' }); s.style.background = it.swatch; b.appendChild(s); }
        b.appendChild(doc.createTextNode(it.label));
        if (it.disabled) b.disabled = true;
        b.addEventListener('click', () => {
          if (o.momentary) { if (o.onChange) o.onChange(it.id); return; }
          C.value = it.id; C.paint(); if (o.onChange) o.onChange(it.id);
        });
        g.appendChild(b);
      }
      C.value = value; C.paint();
    };
    C.set = (v, fire = false) => { C.value = v; C.paint(); if (fire && o.onChange) o.onChange(v); };
    C.setItems(o.items || [], o.value ?? null);
    return reg(S, C);
  }

  // label left, value right (tabular), the range under them.
  function slider(S, o) {
    const r = row(S, 'snp-slider', o);
    const lab = el('div', 'snp-label');
    const l = el('label', 'snp-ltext', { for: o.id }); l.textContent = o.label;
    const out = el('output', 'snp-val', { for: o.id, id: o.valueId || null, 'aria-hidden': 'true' });
    lab.append(l, out);
    const inp = el('input', 'snp-range', { type: 'range', id: o.id, min: o.min, max: o.max, step: o.step ?? 'any' });
    r.append(lab, inp);
    addHint(r, lab, o);
    const fmt = v => (o.format ? o.format(v) : String(v)) + (o.unit ? ` ${o.unit}` : '');
    const C = { id: o.id, el: r, input: inp, out };
    const show = () => {
      const t = fmt(+inp.value);
      out.textContent = t; inp.setAttribute('aria-valuetext', t);
      const k = (+inp.value - o.min) / ((o.max - o.min) || 1);
      inp.style.setProperty('--fill', `${Math.max(0, Math.min(1, k)) * 100}%`);
    };
    Object.defineProperty(C, 'value', { get: () => +inp.value });
    C.set = (v, fire = false) => { inp.value = String(v); show(); if (fire) { if (o.onInput) o.onInput(+inp.value); if (o.onChange) o.onChange(+inp.value); } };
    C.show = show;
    inp.value = String(o.value ?? o.min);
    inp.addEventListener('input', () => { show(); if (o.onInput) o.onInput(+inp.value); });
    inp.addEventListener('change', () => { show(); if (o.onChange) o.onChange(+inp.value); });
    show();
    return reg(S, C);
  }

  // a switch: the whole row is the label, so a tap anywhere toggles it.
  function toggle(S, o) {
    const r = row(S, 'snp-toggle', o);
    const l = el('label', 'snp-label snp-tlabel', { for: o.id });
    const t = el('span', 'snp-ltext'); t.textContent = o.label;
    const inp = el('input', 'snp-check', { type: 'checkbox', role: 'switch', id: o.id });
    const sw = el('span', 'snp-switch', { 'aria-hidden': 'true' });
    l.append(t, inp, sw);
    r.appendChild(l);
    if (o.hint) {
      // the info button sits outside the label (a click on it must not toggle)
      const lab = el('div', 'snp-label snp-hintbar');
      r.insertBefore(lab, l.nextSibling);
      addHint(r, lab, o);
      r.classList.add('has-hint');
    }
    inp.checked = !!o.value;
    const C = { id: o.id, el: r, input: inp };
    Object.defineProperty(C, 'value', { get: () => inp.checked });
    C.set = (v, fire = false) => { inp.checked = !!v; if (fire && o.onChange) o.onChange(inp.checked); };
    inp.addEventListener('change', () => { if (o.onChange) o.onChange(inp.checked); });
    return reg(S, C);
  }

  // a native select. options: { id, label, group }.
  function select(S, o) {
    const r = row(S, 'snp-select', o);
    const lab = el('div', 'snp-label');
    const l = el('label', 'snp-ltext', { for: o.id }); l.textContent = o.label;
    lab.appendChild(l);
    const wrap = el('div', 'snp-selwrap');
    const sel = el('select', 'snp-sel', { id: o.id });
    wrap.appendChild(sel);
    r.append(lab, wrap);
    addHint(r, lab, o);
    const C = { id: o.id, el: r, input: sel };
    C.setItems = (opts, value) => {
      sel.innerHTML = '';
      const groups = new Map();
      for (const it of opts) {
        const op = el('option', null, { value: String(it.id) }); op.textContent = it.label;
        if (it.disabled) op.disabled = true;
        if (it.group) {
          if (!groups.has(it.group)) { const og = el('optgroup', null, { label: it.group }); groups.set(it.group, og); sel.appendChild(og); }
          groups.get(it.group).appendChild(op);
        } else sel.appendChild(op);
      }
      if (value != null) sel.value = String(value);
    };
    Object.defineProperty(C, 'value', { get: () => sel.value });
    C.set = (v, fire = false) => { sel.value = String(v); if (fire && o.onChange) o.onChange(sel.value); };
    C.setItems(o.options || [], o.value);
    sel.addEventListener('change', () => { if (o.onChange) o.onChange(sel.value); });
    return reg(S, C);
  }

  function makeButton(o) {
    const b = el('button', `snp-btn snp-${o.kind || 'secondary'}`, { type: 'button', id: o.id || null, title: o.title || null, 'aria-pressed': o.pressed == null ? null : String(!!o.pressed) });
    b.innerHTML = (o.icon ? icon(o.icon) : '') + '<span class="snp-btext"></span>';
    b.lastChild.textContent = o.label;
    if (o.onClick) b.addEventListener('click', o.onClick);
    return b;
  }
  function buttonCtl(b) {
    return {
      id: b.id, el: b, input: b,
      setLabel(t, ic) { b.querySelector('.snp-btext').textContent = t; if (ic) { const s = b.querySelector('svg'); if (s) s.outerHTML = icon(ic); } },
      setPressed(v) { b.setAttribute('aria-pressed', String(!!v)); b.classList.toggle('on', !!v); },
    };
  }
  function button(S, o) {
    const r = row(S, 'snp-buttons', o);
    const b = makeButton(o); r.appendChild(b);
    return reg(S, Object.assign(buttonCtl(b), { el: r }));
  }
  // a row of 2 or 3 buttons of equal width. Returns the button controls.
  function actions(S, o) {
    const list = Array.isArray(o) ? o : o.items;
    const r = row(S, 'snp-buttons snp-actions', {});
    r.style.setProperty('--cols', list.length);
    return list.map(it => { const b = makeButton(it); r.appendChild(b); return reg(S, buttonCtl(b)); });
  }
  function slot(S, o) {
    const r = row(S, 'snp-slot', o);
    if (o.label) { const lab = el('div', 'snp-label'); lab.appendChild(el('span', 'snp-ltext')).textContent = o.label; r.appendChild(lab); addHint(r, lab, o); }
    const box = o.el || el('div', 'snp-slotbox');
    if (o.id) box.id = o.id;
    r.appendChild(box);
    return reg(S, { id: o.id, el: r, input: box });
  }
  function note(S, o) {
    const p = el('p', `snp-note${o.tone ? ' snp-' + o.tone : ''}`, { id: o.id || null, 'aria-live': o.live ? 'polite' : null });
    p.textContent = o.text || '';
    if (o.hidden) p.hidden = true;
    S.body.appendChild(p);
    return reg(S, { id: o.id, el: p, input: p, set(t) { p.textContent = t; } });
  }
  function label(S, o) {
    const h = el('h3', 'snp-sub'); h.textContent = typeof o === 'string' ? o : o.text;
    S.body.appendChild(h);
    return { el: h };
  }

  const factories = {
    segmented: (S, o) => choice(S, o, 'seg'),
    chips: (S, o) => choice(S, o, 'chips'),
    slider, toggle, select, button, actions, slot, note, label,
  };
  const api = {
    root, sections, controls,
    section,
    find: id => controls.get(String(id)) || null,
    get: id => sections.get(id) || null,
  };
  for (const k of Object.keys(factories)) {
    api[k] = o => {
      const S = sections.get(o.section);
      if (!S) throw new Error(`sn-panel: no section "${o.section}"`);
      return factories[k](S, o);
    };
  }
  return api;
}

// ── the panel shell: open and close, the phone sheet grip ──────────────────
// panel: the <aside>; grip, menu, close, gear: elements or null. phoneQ: a
// MediaQueryList. onOpen(open). The sheet state: 'closed' | 'half' | 'full'.
export function mountSheet({ panel, grip = null, menu = null, close = null, gear = null, phoneQ, onOpen = () => {}, doc = panel.ownerDocument }) {
  const body = doc.body;
  const st = { open: false, sheet: 'closed' };
  function setOpen(open, sheet) {
    st.open = !!open;
    st.sheet = !st.open ? 'closed' : sheet || (st.sheet === 'closed' ? 'half' : st.sheet);
    panel.classList.toggle('open', st.open);
    panel.classList.toggle('full', st.sheet === 'full');
    panel.style.transform = '';
    body.classList.toggle('panel-closed', !st.open);
    if (menu) { menu.classList.toggle('on', st.open); menu.setAttribute('aria-expanded', String(st.open)); }
    if (gear) gear.setAttribute('aria-expanded', String(st.open));
    onOpen(st.open, st.sheet);
  }
  if (grip) {
    let y0 = null;
    grip.addEventListener('pointerdown', e => { y0 = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ } });
    grip.addEventListener('pointermove', e => {
      if (y0 === null) return;
      const dy = e.clientY - y0;
      panel.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
    });
    grip.addEventListener('pointerup', e => {
      if (y0 === null) return;
      const dy = e.clientY - y0; y0 = null;
      const next = sheetSnap(st.sheet, dy);
      if (next === 'closed') setOpen(false); else setOpen(true, next);
    });
    grip.addEventListener('pointercancel', () => { y0 = null; panel.style.transform = ''; });
    // the grip is a button for the keyboard too: Enter or Space = a tap
    grip.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); setOpen(true, sheetSnap(st.sheet, 0));
    });
  }
  if (menu) menu.addEventListener('click', () => setOpen(!st.open));
  if (close) close.addEventListener('click', () => { setOpen(false); if (gear && !phoneQ.matches && gear.focus) gear.focus(); });
  if (gear) gear.addEventListener('click', () => setOpen(true));
  setOpen(!phoneQ.matches);
  const onQ = e => setOpen(!e.matches);
  if (phoneQ.addEventListener) phoneQ.addEventListener('change', onQ);
  else if (phoneQ.addListener) phoneQ.addListener(onQ);
  return { st, setOpen, get open() { return st.open; }, get sheet() { return st.sheet; } };
}
