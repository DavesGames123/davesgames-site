// ============================================================================
//  NOISE TABLE  ·  inspector.js — the modal that shows one function
// ----------------------------------------------------------------------------
//  initInspector(pack) indexes every function in the pack, then wires each tile
//  to open the modal, plus the close, copy and keyboard controls. open(t) fills
//  the modal: the name, the function and family line, the species text, the
//  colorized WGSL of that function, and a slider per named knob. A knob edit
//  marks the tile dirty so the frame loop repaints it.
//
//  fnSource(name) returns the function plus every helper it reaches. It walks
//  the call graph from fnIndex, so the source shown is self-contained.
//  currentInspected() tells main.js which tile, if any, the modal shows, so the
//  frame loop draws the big cell and keeps it live.
// ============================================================================
import { $, tiles } from './state.js';
import { highlight } from './highlight.js';

let inspected = null;
let modal = null;
let PACK = null;
const fnIndex = {};

export function currentInspected() { return inspected; }

// the cell's function plus every helper it reaches, transitively, so the source shown is self-contained
function fnSource(name) {
  const seen = new Set(), order = [];
  const visit = n => { if (seen.has(n) || !fnIndex[n]) return; seen.add(n); const src = fnIndex[n]; for (const [, callee] of src.matchAll(/\b(\w+)\(/g)) if (callee !== n && fnIndex[callee]) visit(callee); order.push(n); };
  visit(name);
  return order.map(n => fnIndex[n]).join('\n\n');
}
function open(t) {
  inspected = t;
  $('m-name').textContent = t.s.name.replace(/_/g, ' '); $('m-fn').textContent = t.s.fn + ' · ' + t.s.family;
  $('m-species').textContent = t.s.species; $('m-src-lbl').textContent = 'WGSL · fn ' + t.s.fn + ' + helpers';
  $('m-src').innerHTML = highlight(fnSource(t.s.fn));
  const kn = $('m-knobs'); kn.innerHTML = '';
  t.s.knobs.forEach((k, i) => {
    if (!k[0]) return;
    const w = document.createElement('div'); w.className = 'knob'; const id = 'knob-' + t.s.name + '-' + i;
    w.innerHTML = `<label for="${id}">k${i} · ${k[0]}</label><output>${t.knobs[i].toFixed(2)}</output><input type="range" id="${id}" min="0" max="1" step="0.01" value="${t.knobs[i]}">`;
    w.querySelector('input').addEventListener('input', e => { t.knobs[i] = +e.target.value; t.dirty = true; w.querySelector('output').textContent = t.knobs[i].toFixed(2); });
    kn.appendChild(w);
  });
  modal.classList.add('open'); $('m-close').focus();
}
function close() { modal.classList.remove('open'); inspected = null; }
const copy = (text, btn, label) => navigator.clipboard.writeText(text).then(() => { btn.textContent = 'Copied'; setTimeout(() => btn.textContent = label, 1200); }).catch(() => { btn.textContent = 'Select the text to copy'; setTimeout(() => btn.textContent = label, 2000); });

export function initInspector(pack) {
  PACK = pack;
  modal = $('modal');
  // index every function body by brace matching, so fnSource can reach helpers
  const FN_RE = /\n(?:\/\/[^\n]*\n)*fn (\w+)\([^{]*\{/g;
  let m; const heads = []; while ((m = FN_RE.exec(PACK))) heads.push({ name: m[1], start: m.index + 1, body: m.index + m[0].length - 1 });
  for (const h of heads) { let depth = 0, j = h.body; for (; j < PACK.length; j++) { if (PACK[j] === '{') depth++; else if (PACK[j] === '}') { depth--; if (depth === 0) break; } } fnIndex[h.name] = PACK.slice(h.start, j + 1); }

  for (const t of tiles) { t.el.addEventListener('click', () => open(t)); t.el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(t); } }); }
  $('m-close').addEventListener('click', close); modal.addEventListener('click', e => { if (e.target === modal) close(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  $('m-copy').addEventListener('click', e => inspected && copy(fnSource(inspected.s.fn), e.currentTarget, 'Copy function'));
  $('m-copy-pack').addEventListener('click', e => copy(PACK, e.currentTarget, 'Copy library'));
}
