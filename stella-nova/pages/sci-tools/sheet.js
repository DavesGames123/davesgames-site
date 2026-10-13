// ============================================================================
//  SCIENCE TOOLKIT  ·  sheet.js  ·  the cheat sheet (reference tables)
// ----------------------------------------------------------------------------
//  The "back of the composition book" tables, always open at the side of
//  the scratchpad on a wide screen (a sheet on a phone, see style.css).
//  A click on a value puts it into the current scratchpad line, through
//  onInsert (pad.insert in main.js):
//    constants   the name ("kB", "$h") or the value with its unit
//    prefixes    the prefix symbol
//    elements    the element symbol
//    pKa         the acid name or one pKa value
//    densities   the density with its unit
//    units       the right side of the equivalence
//
//  PHONE  (max-width 760px, style.css) the tables are a bottom sheet with
//         one tab per table. The "Tables" button (#sheetBtn) opens it;
//         the close button or Esc closes it. The filter shows every
//         matching table at once.
//
//  The data comes from core/constants.js (CODATA 2022), core/chem.js
//  (element data of the Periodic Table page) and core/ref.js (prefixes,
//  pKa, densities, unit equivalences). Each table shows its source.
//
//  GREP MAP
//    grep -n "export function initSheet"  build the tables, bind the clicks
//    grep -n "const KEY_CONSTS"           the constants shown first
//    grep -n "function periodic"          the 18-column periodic table
//    grep -n "function filter"            the filter box
//    grep -n "function setTab"            the phone tabs
//    grep -n "function setOpen"           the phone sheet open or closed
// ============================================================================
import { ROWS, CONST } from './core/constants.js';
import { EL } from './core/chem.js';
import { PREFIXES, ACIDS, DENSITY, DENSITY_ELEMENTS, SRC, equivalences } from './core/ref.js';
import { esc } from './kit.js';
import { nice, prettyUnit } from './intent.js';

// The constants shown first; the rest are behind "all constants".
const KEY_CONSTS = ['h', 'hbar', 'c', 'qe', 'kB', 'NA', 'R', 'F', 'G', 'gn', 'eps0', 'mu0', 'sigma', 'b', 'me', 'mp', 'mn', 'mu', 'a0', 'Ry', 'alpha', 'Vm', 'atm', 'au'];
// Plain-text symbols (the table has TeX; plain text keeps the sheet light).
const SYM = { hbar: 'ħ', qe: 'e', kB: 'k_B', NA: 'N_A', gn: 'g_n', eps0: 'ε₀', mu0: 'μ₀', sigma: 'σ', b: 'b (Wien)', me: 'm_e', mp: 'm_p', mn: 'm_n', mu: 'm_u', a0: 'a₀', Ry: 'Ry', alpha: 'α', Vm: 'V_m', Rinf: 'R∞', alphainv: '1/α' };
// Names that are also units go in with "$" so they always read as the constant.
const AMBIG = new Set(['h', 'G', 'F', 'b']);
const insName = (id) => (AMBIG.has(id) ? '$' + id : id);
const valText = (v) => (Number.isInteger(v) && Math.abs(v) < 1e12 ? String(v) : String(v).replace('e+', 'e'));
const unitText = (u) => prettyUnit(u || '').replace(/ohm/g, 'Ω');

function constRows(ids) {
  return ids.map(id => {
    const c = CONST[id];
    const u = unitText(c.unit);
    const ins = `(${valText(c.v)}${u ? ' ' + u : ''})`;
    return `<tr data-f="${esc((id + ' ' + c.name).toLowerCase())}"><td><button type="button" class="ins sym" data-ins="${esc(insName(id))}" title="Insert the name ${esc(insName(id))}">${esc(SYM[id] || id)}</button></td>` +
      `<td><button type="button" class="ins num" data-ins="${esc(ins)}" title="${esc(c.name)}${c.unc ? '' : ' (exact)'}: insert the value">${esc(nice(c.v, 6))}</button></td><td class="u">${esc(u)}</td></tr>`;
  }).join('');
}

function periodic() {
  const cells = [];
  for (const e of Object.values(EL)) {
    let row = e.period, col = e.group;
    if (col == null) { row = e.period + 3; col = e.z - (e.period === 6 ? 57 : 89) + 3; }
    cells.push(`<button type="button" class="el c-${esc(e.cat || 'x')}" style="grid-row:${row};grid-column:${col}" data-ins="${esc(e.sym)}" data-el="${esc(e.sym)}" title="${esc(`${e.sym} ${e.name}, Z ${e.z}, ${e.mass}${e.massNum != null ? ' (isotope ' + e.massNum + ')' : ''} g/mol`)}">${esc(e.sym)}</button>`);
  }
  return `<div class="ptable" role="group" aria-label="Periodic table: click an element to insert its symbol">${cells.join('')}<span class="fgap" style="grid-row:8;grid-column:1/-1"></span></div><p class="elread dim" aria-live="polite">Click an element: its symbol goes into the line.</p>`;
}

function section(id, title, body, src, open = true) {
  return `<details class="tbl" id="t-${id}" ${open ? 'open' : ''}><summary>${esc(title)}</summary>${body}${src ? `<p class="src">${src}</p>` : ''}</details>`;
}

const TABS = [['const', 'Constants'], ['pre', 'Prefixes'], ['el', 'Elements'], ['pka', 'pKa'], ['dens', 'Densities'], ['units', 'Units']];

export function initSheet({ root, onInsert, button }) {
  const others = ROWS.map(r => r[0]).filter(id => !KEY_CONSTS.includes(id));
  const constBody = `<table class="ct"><tbody>${constRows(KEY_CONSTS)}</tbody></table>` +
    `<details class="allc"><summary>all ${ROWS.length} constants</summary><table class="ct"><tbody>${constRows(others)}</tbody></table></details>`;

  const pre = `<div class="prefixes">${PREFIXES.map(([s, n, f]) => `<button type="button" class="ins pf" data-ins="${esc(s)}" data-f="${esc(n)}" title="${esc(n)} = 1e${Math.round(Math.log10(f))}"><b>${esc(s)}</b><span>${esc(n)}</span><i>10${esc(sup(Math.round(Math.log10(f))))}</i></button>`).join('')}</div>`;

  const pka = `<table class="ct"><thead><tr><th>Acid or base</th><th>pKa</th></tr></thead><tbody>${ACIDS.map(a => {
    const vals = a.kind.startsWith('strong') ? `<span class="dim">strong${a.n > 1 ? ', ' + a.n + ' OH⁻' : ''}</span>` : a.kind === 'sulfuric' ? `<span class="dim">strong,</span> <button type="button" class="ins num" data-ins="1.99">1.99</button>` : a.pKa.map(p => `<button type="button" class="ins num" data-ins="${p}">${p}</button>`).join(' ');
    return `<tr data-f="${esc((a.name + ' ' + a.formula + ' ' + a.alt).toLowerCase())}"><td><button type="button" class="ins" data-ins="${esc(a.name)}" title="Insert the name: pH of 0.1 M ${esc(a.name)}">${esc(a.name)}</button> <span class="dim f">${esc(a.formula)}</span>${a.kind === 'base' ? ' <span class="dim">(BH⁺)</span>' : ''}</td><td class="pk">${vals}</td></tr>`;
  }).join('')}</tbody></table>`;

  const dens = [...DENSITY.map(([n, v, cond, src]) => [n, v, cond, src]), ...DENSITY_ELEMENTS.map(s => [EL[s].name.toLowerCase(), EL[s].density, 'solid', 'elements'])];
  const densBody = `<table class="ct"><thead><tr><th>Substance</th><th>g/cm³</th><th></th></tr></thead><tbody>${dens.map(([n, v, cond]) =>
    `<tr data-f="${esc(n)}"><td>${esc(n)}</td><td><button type="button" class="ins num" data-ins="(${v} g/mL)" title="Insert ${v} g/mL">${esc(String(v))}</button></td><td class="u">${esc(cond)}</td></tr>`).join('')}</tbody></table>`;

  let eq = [];
  try { eq = equivalences(); } catch (e) { eq = []; }
  const unitsBody = `<table class="ct"><tbody>${eq.map(([a, v, u]) =>
    `<tr data-f="${esc((a + ' ' + u).toLowerCase())}"><td>${esc(a)}</td><td>=</td><td><button type="button" class="ins num" data-ins="${esc(`${nice(v, 8)} ${u}`)}">${esc(nice(v, 6))}</button> <span class="u">${esc(u)}</span></td></tr>`).join('')}</tbody></table>`;

  root.innerHTML = `<div class="sheethead"><h2>Tables</h2><input id="sheetFilter" type="search" placeholder="Filter: planck, acetic, ethanol, psi" aria-label="Filter the tables" autocomplete="off" spellcheck="false"><button id="sheetClose" class="mini" type="button" aria-label="Close the tables">Close</button>` +
    `<nav class="stabs" role="tablist" aria-label="Tables">${TABS.map(([id, n]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${id === 'const'}">${n}</button>`).join('')}</nav><p class="flash dim" aria-live="polite"></p></div>` +
    `<div class="sheetbody">` +
    section('const', 'Constants (CODATA 2022)', constBody, 'E. Tiesinga et al., CODATA 2022, NIST (2024). Click a symbol to insert its name, a value to insert it with its unit.') +
    section('pre', 'SI prefixes', pre, esc(SRC.si)) +
    section('el', 'Periodic table', periodic(), "IUPAC 2021 standard atomic weights, from this site's Periodic Table data.") +
    section('pka', 'pKa at 25 °C', pka, esc(SRC.pka)) +
    section('dens', 'Densities', densBody, [SRC.water, SRC.crc, SRC.sea, SRC.air, SRC.elements].map(esc).join(' ')) +
    section('units', 'Unit equivalences', unitsBody, esc(SRC.units)) +
    `</div>`;

  const read = root.querySelector('.elread');
  const flash = root.querySelector('.flash');
  function setTab(id) {
    root.dataset.tab = id;
    root.querySelectorAll('.stabs [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
    root.querySelectorAll('details.tbl').forEach(d => { d.classList.toggle('cur', d.id === 't-' + id); if (d.id === 't-' + id) d.open = true; });
  }
  function setOpen(on) {
    root.classList.toggle('open', on);
    if (button) button.setAttribute('aria-expanded', String(on));
  }
  setTab('const');
  root.querySelector('.stabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
  root.querySelector('#sheetClose').addEventListener('click', () => { setOpen(false); if (button) button.focus(); });
  if (button) button.addEventListener('click', () => setOpen(!root.classList.contains('open')));
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.classList.contains('open')) { setOpen(false); e.stopPropagation(); if (button) button.focus(); } });
  root.addEventListener('mousedown', (e) => { if (e.target.closest('[data-ins]')) e.preventDefault(); });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ins]');
    if (!b) return;
    if (b.dataset.el && read) {
      const el = EL[b.dataset.el];
      read.textContent = `${el.sym} · ${el.name} · Z ${el.z} · ${el.mass} g/mol${el.massNum != null ? ' (longest-lived isotope)' : ''}`;
    }
    const where = onInsert && onInsert(b.dataset.ins);
    if (flash) flash.textContent = `${b.dataset.ins} → ${where || 'the line'}`;
  });
  const box = root.querySelector('#sheetFilter');
  box.addEventListener('input', () => { root.classList.toggle('filtering', !!box.value.trim()); filter(root, box.value); });
  return { filter: (q) => { box.value = q; root.classList.toggle('filtering', !!String(q).trim()); filter(root, q); }, setTab, setOpen };
}

// Hide rows that do not hold every word; hide a table with no rows left.
function filter(root, q) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  for (const sec of root.querySelectorAll('details.tbl')) {
    const rows = [...sec.querySelectorAll('[data-f]')];
    let shown = 0;
    for (const r of rows) {
      const hit = words.every(w => r.dataset.f.includes(w));
      r.hidden = !hit;
      if (hit) shown++;
    }
    const isList = rows.length > 0;
    sec.hidden = words.length > 0 && (!isList || !shown);
    if (words.length && shown) { sec.open = true; const all = sec.querySelector('details.allc'); if (all && [...all.querySelectorAll('[data-f]')].some(r => !r.hidden)) all.open = true; }
  }
}

const SUPN = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
function sup(n) { return [...String(n)].map(c => SUPN[c] ?? c).join(''); }
