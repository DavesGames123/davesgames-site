// ============================================================================
//  PRESENCE ORBS  ·  inspector.js — the modal that shows one species
// ----------------------------------------------------------------------------
//  initInspector(packs) wires each tile to open the modal, plus the close,
//  copy and keyboard controls. open(t) fills the modal: the name, the function
//  and family line, the species text, the colorized WGSL of that one function,
//  and a slider per knob bound to the tile's live knob values. fnSource(t)
//  slices the function body out of its pack by brace matching. currentInspected()
//  tells main.js which tile, if any, the modal shows, so the frame loop draws
//  the big orb and skips the grid behind the blur.
// ============================================================================
import { $, tiles } from './state.js';
import { highlight } from './highlight.js';

let inspected = null;
let modal = null;
let PACKS = null;

export function currentInspected() { return inspected; }

function fnSource(t) {
  const src = PACKS[t.s.family];
  const i = src.indexOf('fn ' + t.s.fn + '(');
  if (i < 0) return '';
  let depth = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (depth === 0) break; } }
  return src.slice(i, j + 1);
}
function open(t) {
  inspected = t;
  $('m-name').textContent = t.s.name;
  $('m-fn').textContent = t.s.fn + ' · ' + t.s.family + ' pack' + (t.s.arc ? ' · settle arc' : '');
  $('m-species').textContent = t.s.species;
  $('m-src-lbl').textContent = 'WGSL · fn ' + t.s.fn;
  $('m-src').innerHTML = highlight(fnSource(t));
  const kn = $('m-knobs'); kn.innerHTML = '';
  t.s.knobs.forEach((k, i) => {
    const w = document.createElement('div'); w.className = 'knob';
    const id = 'knob-' + t.s.name + '-' + i;
    w.innerHTML = `<label for="${id}">c${i} · ${k[0]}</label><output>${t.knobs[i].toFixed(2)}</output><input type="range" id="${id}" min="0" max="1" step="0.01" value="${t.knobs[i]}">`;
    w.querySelector('input').addEventListener('input', e => { t.knobs[i] = +e.target.value; w.querySelector('output').textContent = t.knobs[i].toFixed(2); });
    kn.appendChild(w);
  });
  modal.classList.add('open'); $('m-close').focus();
}
function close() { modal.classList.remove('open'); inspected = null; }
const copy = (text, btn, label) => navigator.clipboard.writeText(text).then(() => { btn.textContent = 'Copied'; setTimeout(() => btn.textContent = label, 1200); }).catch(() => { btn.textContent = 'Select the text to copy'; setTimeout(() => btn.textContent = label, 2000); });

export function initInspector(packs) {
  PACKS = packs;
  modal = $('modal');
  for (const t of tiles) { t.el.addEventListener('click', () => open(t)); t.el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(t); } }); }
  $('m-close').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  $('m-copy').addEventListener('click', e => inspected && copy(fnSource(inspected), e.currentTarget, 'Copy function'));
  $('m-copy-pack').addEventListener('click', e => inspected && copy(PACKS[inspected.s.family], e.currentTarget, 'Copy pack'));
}
