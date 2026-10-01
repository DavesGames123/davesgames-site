// ============================================================================
//  PROTEIN VIEWER  ·  app/ui.js — the panel controls, the dock and the keys
// ────────────────────────────────────────────────────────────────────────────
//  buildUI() fills the preset list and the button rows and installs their
//  listeners. syncUI() writes S to the buttons, the chain list, the legend
//  and the structure text.
//
//  GREP MAP
//    const REPS / SHOWS                    rep and toggle buttons
//    function markPreset                   mark the preset button
//    function buildUI                      make the controls
//    function setRep / setColor            change the rep or the scheme
//    function syncUI                       S to the controls and the text
//    keydown                               Esc, f, r, [ ] and , .
// ============================================================================
import { SCHEMES, residueColors, legend, toHex } from '../colors.js';
import { GROUPS, PRESETS } from '../presets.js';
import { $, PHONE_Q, cap, esc } from './env.js';
import { S, dirty, isPolymer } from './state.js';
import { mol, post } from './stage.js';
import { hideLoading, nextFrame, showLoading, toast } from './feedback.js';
import { fetchId, loadFile, loadPreset, loadText } from './load.js';
import { rebuild, rebuildOverlay } from './layers.js';
import { applyOpacity, paint } from './paint.js';
import { neighbours } from './pick.js';
import { clearSelection, stepResidue } from './select.js';
import { hideCard, showCard } from './card.js';
import { setMeasure, syncMeasure } from './measure.js';
import { stripColors } from './strip.js';
import { focusSelection, resetView } from './camera.js';
import { panel, setOpen } from './panel.js';

const REPS = [
  { id: 'cartoon', label: 'Cartoon', short: 'Cartoon' },
  { id: 'trace', label: 'Backbone', short: 'Trace' },
  { id: 'ballstick', label: 'Ball & stick', short: 'Balls' },
  { id: 'licorice', label: 'Licorice', short: 'Sticks' },
  { id: 'spacefill', label: 'Spacefill', short: 'Spheres' },
  { id: 'surface', label: 'Surface', short: 'Surface' },
];
const SHOWS = [
  { id: 'ligands', label: 'Ligands' }, { id: 'ions', label: 'Ions' }, { id: 'waters', label: 'Waters' },
  { id: 'hydrogens', label: 'Hydrogens' }, { id: 'additives', label: 'Additives' },
];

export function markPreset(id) {
  document.querySelectorAll('.pc').forEach(b => b.classList.toggle('on', b.dataset.id === id));
}
export function buildUI() {
  // presets, grouped
  let html = '';
  for (const g of GROUPS) {
    const list = PRESETS.filter(p => p.group === g.id);
    if (!list.length) continue;
    html += `<div class="grp">${esc(g.label)}</div>`;
    for (const p of list) html += `<button type="button" class="pc" data-id="${p.id}"><b>${esc(p.title)}<code>${esc(p.code)}</code></b><span>${esc(p.why)}</span></button>`;
  }
  $('presets').innerHTML = html;
  $('presets').addEventListener('click', e => {
    const b = e.target.closest('.pc');
    if (!b) return;
    loadPreset(b.dataset.id);
    if (PHONE_Q.matches) setOpen(false);
  });
  $('reps').innerHTML = REPS.map(r => `<button type="button" data-rep="${r.id}">${esc(r.label)}</button>`).join('');
  $('reps').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setRep(b.dataset.rep); });
  $('shows').innerHTML = SHOWS.map(t => `<button type="button" class="tog" data-show="${t.id}">${esc(t.label)}</button>`).join('');
  $('shows').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const k = b.dataset.show;
    S.show[k] = !S.show[k];
    if (k === 'hydrogens') S.surfCache = null;
    syncUI(); rebuild();
    if (S.sel) { S.hood = neighbours(S.sel.res); showCard(); rebuildOverlay(); paint(); }
  });
  $('colors').innerHTML = SCHEMES.map(c => `<button type="button" data-color="${c.id}">${esc(c.label)}</button>`).join('');
  $('colors').addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.disabled) setColor(b.dataset.color); });
  $('chains').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const ci = +b.dataset.c;
    const on = S.chainOn[ci];
    const nOn = S.s.chains.filter((c, i) => S.chainOn[i] && c.residues.some(ri => isPolymer(S.s.residues[ri]))).length;
    if (on && nOn <= 1) { toast('At least one chain stays visible'); return; }
    S.chainOn[ci] = on ? 0 : 1;
    S.surfCache = null;
    if (S.sel && !S.chainOn[S.s.residues[S.sel.res].chain]) { S.sel = null; S.hood = new Map(); hideCard(); }
    rebuild(); syncUI(); stripColors();
  });
  $('opacity').addEventListener('input', e => { S.opacity = +e.target.value; $('opacityV').textContent = Math.round(S.opacity * 100) + '%'; applyOpacity(); rebuildOverlay(); paint(); });
  $('measureModes').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMeasure(+b.dataset.m); });
  $('bFocus').addEventListener('click', focusSelection);
  $('bReset').addEventListener('click', () => resetView(false));
  $('bClear').addEventListener('click', clearSelection);
  $('bSpin').addEventListener('click', () => { S.spin = !S.spin; $('bSpin').classList.toggle('on', S.spin); dirty(); });
  $('looks').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const k = b.dataset.look;
    S.look[k] = !S.look[k]; post.opts[k] = S.look[k];
    b.classList.toggle('on', S.look[k]); dirty();
  });
  // load
  $('fetchForm').addEventListener('submit', e => { e.preventDefault(); $('fetchId').blur(); fetchId($('fetchId').value); });
  $('openFile').addEventListener('click', () => $('fileIn').click());
  $('fileIn').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    if (f) await loadFile(f);
    e.target.value = '';
  });
  $('pasteToggle').addEventListener('click', () => { $('pasteBox').hidden = !$('pasteBox').hidden; $('pasteToggle').classList.toggle('on', !$('pasteBox').hidden); });
  $('pasteLoad').addEventListener('click', async () => {
    const t = $('pasteText').value;
    if (!t.trim()) { toast('Paste PDB or mmCIF text first', true); return; }
    if (await loadText(t, 'Pasted structure') && PHONE_Q.matches) setOpen(false);
  });
  // dock
  $('dockRep').addEventListener('click', () => { const k = REPS.findIndex(r => r.id === S.rep); setRep(REPS[(k + 1) % REPS.length].id); });
  $('dockColor').addEventListener('click', () => {
    const avail = SCHEMES.filter(c => c.id !== 'plddt' || (S.s && S.s.meta.af));
    const k = avail.findIndex(c => c.id === S.color);
    setColor(avail[(k + 1) % avail.length].id);
  });
  $('dockMeasure').addEventListener('click', () => setMeasure(S.measure ? 0 : 2));
  $('dockFit').addEventListener('click', () => { if (S.sel) clearSelection(); resetView(false); });
}
export function setRep(id) {
  if (!S.s || id === S.rep && mol.children.length) return;
  S.rep = id;
  syncUI();
  const big = S.s.atoms.length > 6000;
  if (id === 'surface' && !S.surfCache && big) {
    showLoading('Computing the surface…');
    nextFrame().then(() => { rebuild(); hideLoading(); });
  } else rebuild();
  toastIf(`Style: ${REPS.find(r => r.id === id).label}`);
}
export function setColor(id) {
  if (!S.s) return;
  S.color = id;
  syncUI(); paint(); stripColors();
  if (S.sel) showCard();
  toastIf(`Colour: ${SCHEMES.find(c => c.id === id).label}`);
}
const toastIf = msg => { if (PHONE_Q.matches && !panel.classList.contains('open')) toast(msg); };

export function syncUI() {
  const s = S.s;
  document.querySelectorAll('#reps button').forEach(b => b.classList.toggle('on', b.dataset.rep === S.rep));
  document.querySelectorAll('#colors button').forEach(b => {
    b.classList.toggle('on', b.dataset.color === S.color);
    b.disabled = b.dataset.color === 'plddt' && !(s && s.meta.af);
    b.title = b.disabled ? 'pLDDT is only in AlphaFold models' : '';
  });
  document.querySelectorAll('#shows button').forEach(b => b.classList.toggle('on', !!S.show[b.dataset.show]));
  $('opRow').classList.toggle('off', S.rep !== 'surface');
  $('opacity').value = S.opacity; $('opacityV').textContent = Math.round(S.opacity * 100) + '%';
  $('dockRepV').textContent = REPS.find(r => r.id === S.rep).short;
  $('dockColorV').textContent = SCHEMES.find(c => c.id === S.color).label;
  syncMeasure();
  if (!s) return;
  // chains
  const CH = s.chains.map((c, i) => ({ c, i })).filter(({ c }) => c.residues.some(ri => isPolymer(s.residues[ri])));
  const col = residueColors(s, 'chain');
  $('chains').innerHTML = CH.map(({ c, i }) => {
    const first = c.residues.find(ri => isPolymer(s.residues[ri]));
    return `<button type="button" data-c="${i}" class="${S.chainOn[i] ? 'on' : ''}" aria-pressed="${!!S.chainOn[i]}"><i style="background:${toHex([col[3 * first], col[3 * first + 1], col[3 * first + 2]])}"></i>${esc(c.id)}</button>`;
  }).join('') || '<span class="note">No polymer chains</span>';
  // legend
  const lg = legend(s, S.color);
  const lgHTML = lg.kind === 'ramp'
    ? `<span class="lg-ramp">${esc(lg.lo)}<i style="background:linear-gradient(90deg,${lg.stops.join(',')})"></i>${esc(lg.hi)}</span><span class="lg-sw">${esc(lg.label)}</span>`
    : lg.items.map(it => `<span class="lg-sw"><i style="background:${it.c}"></i>${esc(it.label)}</span>`).join('');
  $('legend').innerHTML = lgHTML; $('legendPanel').innerHTML = lgHTML;
  // header, read, info, about
  const p = S.preset, m = s.meta;
  const plain = (m.title || '').replace(/^alphafold (monomer )?v[\d.]+ prediction for /i, '').replace(/\s*\([A-Z0-9]{6,10}\)\s*$/, '');
  const title = p ? p.title : (plain ? cap(plain.slice(0, 80)) : m.name || 'Structure');
  $('pTitle').textContent = title;
  $('pKind').textContent = p ? `${p.code} · ${GROUPS.find(g => g.id === p.group).label}` : (m.name || 'Loaded structure');
  $('pWhy').textContent = p ? p.why : (m.title ? cap(m.title) : '');
  const nPol = s.residues.filter(isPolymer).length;
  const meth = m.af ? 'AlphaFold prediction' : m.method ? cap(m.method) : '';
  $('read').innerHTML = `<b>${esc(title)}</b><span class="code">${esc(p ? p.code : m.name || '')}</span><span class="meta"> · ${esc(meth)}${m.resolution ? ` · ${m.resolution.toFixed(2)} Å` : ''} · ${s.atoms.length.toLocaleString()} atoms</span>`;
  const ssSrc = { file: 'from the file (HELIX/SHEET)', computed: 'computed here from backbone H-bonds', none: 'none (no protein)' }[s.ssSource];
  const rows = [
    ['Title', m.title || '—'], ['Entry', m.id || m.name || '—'], ['Method', meth || '—'],
    ['Resolution', m.resolution ? m.resolution.toFixed(2) + ' Å' : '—'], ['Format', m.format === 'mmcif' ? 'mmCIF' : 'PDB'],
    ['Polymer chains', String(CH.length)], ['Residues', nPol.toLocaleString()], ['Atoms', s.atoms.length.toLocaleString()],
    ['Ligands', [...new Set(s.residues.filter(r => r.kind === 'ligand').map(r => r.name))].slice(0, 12).join(' ') || '—'],
    ['Secondary structure', ssSrc],
  ];
  $('info').innerHTML = rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
  $('about').innerHTML = p ? `<p>${esc(p.about)}</p>` : `<p>${esc(m.title || 'A structure you loaded.')} ${m.af ? 'Colour by pLDDT to see where the prediction is confident.' : ''}</p>`;
}

window.addEventListener('keydown', e => {
  if (e.target.closest('input,textarea')) return;
  if (e.key === 'Escape') { if (S.measure) setMeasure(0); else clearSelection(); }
  else if (e.key === 'f') focusSelection();
  else if (e.key === 'r') resetView(false);
  else if (e.key === '[' || e.key === ',') stepResidue(-1);
  else if (e.key === ']' || e.key === '.') stepResidue(1);
});
