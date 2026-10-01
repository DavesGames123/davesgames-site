// ============================================================================
//  MATERIAL STUDIO  ·  export/ui/dom.js — DOM helpers of the export UI
// ────────────────────────────────────────────────────────────────────────────
//  h builds an element from a tag, attributes and children. An "on..."
//  attribute adds a listener. sel, row and chk build the option controls
//  (class io-sel, io-row, io-chk). download saves a Blob through a
//  temporary <a download> and frees the object URL after 30 s.
//
//  GREP TARGETS
//      h  sel  row  chk  download
// ============================================================================
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
export function sel(id, options, value, on) {
  const s = h('select', { class: 'io-sel', id });
  for (const op of options) s.add(new Option(op.label ?? op, String(op.value ?? op)));
  s.value = String(value);
  s.addEventListener('change', () => on(s.value));
  return s;
}
export function row(label, ctl, hint) {
  return h('label', { class: 'io-row' }, h('span', { class: 'io-k' }, label), ctl, hint ? h('span', { class: 'io-hint' }, hint) : null);
}
export function chk(label, value, on) {
  const c = h('input', { type: 'checkbox' }); c.checked = !!value;
  c.addEventListener('change', () => on(c.checked));
  return h('label', { class: 'io-chk' }, c, h('span', {}, label));
}

/** Save a Blob as a download. */
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name || blob.fileName || 'download';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
