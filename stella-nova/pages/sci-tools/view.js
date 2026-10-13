// ============================================================================
//  SCIENCE TOOLKIT  ·  view.js  ·  DOM helpers shared by the page parts
// ----------------------------------------------------------------------------
//  main.js (the full tool view) and pad.js (forms under a scratchpad line)
//  build tool inputs and result tables with the same code, so a field
//  looks and reads the same in both places.
//
//  GREP MAP
//    grep -n "export function field"      one input of a tool definition
//    grep -n "export function valueOf"    the value of an input element
//    grep -n "export function rowsHTML"   result rows as a table
//    grep -n "export async function texInto"  MathJax with a cache
//    grep -n "export async function copyText" clipboard with a fallback
// ============================================================================
import { typeset } from '../../lib/sci-math.js';
import { esc } from './kit.js';

export function valueOf(el, inp) {
  if (!el) return inp.def ?? '';
  if (inp.type === 'check') return el.checked ? '1' : '0';
  return el.value;
}

// One input. idp makes the element id unique ("f-" for the full view).
export function field(inp, value, idp = 'f-') {
  const id = `${idp}${inp.k}`;
  const wrap = document.createElement('div');
  wrap.className = `fld${inp.w ? ' w' + inp.w : ''}${inp.type === 'check' ? ' check' : ''}${inp.type === 'area' ? ' w3' : ''}`;
  let el;
  if (inp.type === 'select') {
    el = document.createElement('select');
    el.innerHTML = inp.opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    el.value = value;
  } else if (inp.type === 'area') {
    el = document.createElement('textarea');
    el.rows = inp.rows || 5;
    el.value = value;
  } else if (inp.type === 'check') {
    el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = value === '1' || value === true;
  } else {
    el = document.createElement('input');
    el.type = 'text';
    el.value = value;
    el.inputMode = inp.mode || 'text';
  }
  el.id = id; el.name = inp.k;
  el.autocomplete = 'off'; el.spellcheck = false;
  const lab = document.createElement('label');
  lab.htmlFor = id; lab.textContent = inp.label;
  if (inp.type === 'check') wrap.append(el, lab); else wrap.append(lab, el);
  if (inp.hint) { const h = document.createElement('span'); h.className = 'hint'; h.textContent = inp.hint; wrap.append(h); }
  return [wrap, el];
}

// Result rows [label, value, note] as a table with copy buttons.
export function rowsHTML(rows) {
  if (!rows || !rows.length) return '';
  return `<table class="res"><tbody>${rows.map(([k, v, note]) =>
    `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}${note ? `<small>${esc(note)}</small>` : ''}</td><td class="c"><button class="mini" type="button" data-copy="${esc(v)}" aria-label="Copy ${esc(k)}">copy</button></td></tr>`).join('')}</tbody></table>`;
}

// MathJax SVG with a cache (one SVG per TeX string).
const texCache = new Map();
export async function texInto(el, tex, display = true) {
  const key = (display ? 'D' : 'I') + tex;
  if (texCache.has(key)) { el.innerHTML = texCache.get(key); el.setAttribute('aria-label', tex); return true; }
  const ok = await typeset(el, tex, { display });
  if (ok) texCache.set(key, el.innerHTML);
  return ok;
}

export async function copyText(text, btn) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; }
  catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
    } catch (e2) { ok = false; }
  }
  if (btn) {
    const was = btn.textContent;
    btn.textContent = ok ? 'copied' : 'copy failed';
    btn.classList.add('done');
    setTimeout(() => { btn.textContent = was; btn.classList.remove('done'); }, 1100);
  }
  return ok;
}
