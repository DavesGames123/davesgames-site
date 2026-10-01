// ============================================================================
//  MATERIAL STUDIO  ·  panels/dom.js — element builder, icons and browser helpers
// ────────────────────────────────────────────────────────────────────────────
//  h() builds elements, icon() and ibtn() draw the 16px stroke icons.
//  The rest wrap browser calls: pointer capture, file download, file pick,
//  the "user is typing" test and the phone layout test.
//
//  GREP TARGETS
//      capture h SVGNS ICONS icon ibtn download pickFiles typing isPhone
// ============================================================================


/** setPointerCapture that tolerates a pointer the browser no longer tracks. */
export function capture(el, e) { try { el.setPointerCapture(e.pointerId); } catch (er) { /* synthetic or ended pointer */ } }

/** Element builder. props: class, style (object), dataset, on<event>, else attribute or property. */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const ICONS = {
  reset: 'M3.5 8a4.5 4.5 0 1 0 1.4-3.3M3.5 2.5v2.6h2.6',
  pin: 'M5.5 2.5h5M6.5 2.5v3.5L4.5 8.5h7L9.5 6V2.5M8 8.5v5',
  star: 'M8 2.2l1.75 3.6 3.95.55-2.85 2.8.7 3.95L8 11.2l-3.55 1.9.7-3.95-2.85-2.8 3.95-.55z',
  trash: 'M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5',
  copy: 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7',
  plus: 'M8 3v10M3 8h10',
  close: 'M4 4l8 8M12 4l-8 8',
  chev: 'M6 4l4 4-4 4',
  dice: 'M3 3h10v10H3zM6 6h.01M10 10h.01M10 6h.01M6 10h.01M8 8h.01',
  search: 'M7 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM10 10l3.5 3.5',
  down: 'M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10',
  file: 'M4 2.5h5l3 3v8H4zM9 2.5v3h3',
  sun: 'M8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
  bulb: 'M8 2a4 4 0 0 1 2.4 7.2V11H5.6V9.2A4 4 0 0 1 8 2zM6 13h4',
  eye: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6.3a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4z',
  drop: 'M8 2s4 4.4 4 7.2A4 4 0 0 1 4 9.2C4 6.4 8 2 8 2z',
  key: 'M2.5 4.5h11v7h-11zM4.5 6.5h1M7.5 6.5h1M10.5 6.5h1M5 9.5h6',
  link: 'M6.5 9.5l3-3M5.5 7.5l-1.3 1.3a2.1 2.1 0 0 0 3 3l1.3-1.3M10.5 8.5l1.3-1.3a2.1 2.1 0 0 0-3-3L7.5 5.5',
};
export function icon(name, cls) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'pn-ico' + (cls ? ' ' + cls : ''));
  const p = document.createElementNS(SVGNS, 'path');
  p.setAttribute('d', ICONS[name] || ''); s.appendChild(p);
  return s;
}
export const ibtn = (name, title, onclick, cls) => h('button', { type: 'button', class: 'pn-ib' + (cls ? ' ' + cls : ''), title, 'aria-label': title, onclick }, icon(name));

export function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export function pickFiles(accept, multiple) {
  return new Promise(res => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    if (multiple) inp.multiple = true;
    inp.addEventListener('change', () => { res([...inp.files]); inp.remove(); });
    document.body.appendChild(inp); inp.click();
  });
}

export const typing = t => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
export const isPhone = () => document.body.dataset.layout === 'phone' || matchMedia('(max-width:768px)').matches;
