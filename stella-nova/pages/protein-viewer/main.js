// ============================================================================
//  PROTEIN VIEWER  ·  main.js — state, UI, picking, strip, measure, camera
// ────────────────────────────────────────────────────────────────────────────
//  One structure at a time. Loading (preset, ID, file or paste) gives a
//  parse.js model; setStructure() centres it, turns its principal axes to
//  the screen (the long axis across, or up on a portrait screen), and
//  builds the layers in the `mol` group. A colour or highlight change only
//  repaints the layers; a rep, filter or chain change rebuilds them.
//
//  RENDER   on demand: the loop draws only when S.dirty is set or the
//           camera moves (post.js passes: scene, AO, composite), then the
//           measurement lines go on top in a second scene.
//  PICK     a ray against spheres round the pickable atoms of the current
//           layers, with a slack of 5 px (mouse) or 18 px (touch). In the
//           cartoon, trace and surface the Cα (or P) atoms stand for their
//           residues; the stick overlay atoms are pickable one by one.
//  SELECT   the residue turns gold, the residues within 5 Å become sticks,
//           the rest dim; the card and the strip follow. A pick that lands
//           under the card or the strip makes the camera pan to it.
//  FRAME    occlusion() measures the panel, the strip and (on a phone) the
//           card; camera.setViewOffset centres the view in the clear part.
//
//  GREP MAP
//    function setStructure / loadPreset / fetchId / loadText   loading
//    function rebuild / rebuildOverlay / paint                 layers
//    function pickAt / onTap / select / showCard / neighbours  picking
//    function addMeasureAtom / measureValue                    measuring
//    function buildStrip / stripMark                           sequence
//    function occlusion / resize / flyTo / resetView / frame   camera
//    function buildUI / syncUI / setOpen                       controls
// ============================================================================
import * as THREE from 'three';
import { parse, makeGrid, AA_NAME } from './parse.js';
import { SCHEMES, residueColors, legend, toHex, PLDDT } from './colors.js';
import { GROUPS, PRESETS, byId } from './presets.js';
import * as R from './reps.js';
import { camera, canvas, clearGroup, controls, envRT, matAtom, matCartoon, matLine, matMark, matSurface, mol, over, overlay, post, renderer, scene } from './app/stage.js';
import { $, COARSE, DPR, HOVER, PHONE_Q, REDUCED, cap, ease, esc } from './app/env.js';
import { ADDITIVES, S, anchorAtom, atomPos, dirty, isPolymer, resLabel } from './app/state.js';
import { hideHint, hideLoading, nextFrame, showLoading, toast } from './app/feedback.js';
import { rebuild, rebuildOverlay } from './app/layers.js';
import { applyOpacity, paint } from './app/paint.js';
import { neighbours, pickAt } from './app/pick.js';
import { addMeasureAtom, setMeasure, syncMeasure } from './app/measure.js';
import { placeLabels } from './app/labels.js';

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
const SS_NAME = { H: 'α-helix', G: '3₁₀-helix', E: 'β-strand', C: 'coil' };
const UNIPROT = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/;

controls.addEventListener('change', dirty);
controls.addEventListener('start', () => { S.fly = null; hideHint(); });

// symmetric 3x3 eigen-decomposition (Jacobi rotations)
function eig3(A) {
  const a = A.map(r => r.slice()), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 40; sweep++) {
    if (a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2 < 1e-14) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-14) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; }
    }
  }
  return [0, 1, 2].map(i => ({ val: a[i][i], vec: [v[0][i], v[1][i], v[2][i]] })).sort((x, y) => y.val - x.val);
}

// ── loading ───────────────────────────────────────────────────────────────
async function decodeBytes(buf) {
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot read gzip files');
    const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    buf = new Uint8Array(await new Response(ds).arrayBuffer());
  }
  return new TextDecoder('latin1').decode(buf);
}
async function fetchText(url, timeout = 30000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await decodeBytes(new Uint8Array(await r.arrayBuffer()));
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('the request timed out');
    throw e;
  } finally { clearTimeout(t); }
}

async function loadPreset(id) {
  const p = byId(id);
  if (!p) return;
  const token = ++S.token;
  showLoading(`Loading ${p.code}…`);
  markPreset(p.id);
  try {
    const text = await fetchText('data/' + p.file);
    if (token !== S.token) return;
    await nextFrame();
    const s = parse(text, p.code);
    if (token !== S.token) return;
    setStructure(s, p);
    try { history.replaceState(null, '', '#' + p.id); } catch (e) { /* sandboxed */ }
  } catch (e) {
    if (token === S.token) toast(`Could not load ${p.code}: ${e.message}`, true);
  } finally { if (token === S.token) hideLoading(); }
}

async function loadText(text, name) {
  const token = ++S.token;
  showLoading(`Reading ${name}…`);
  await nextFrame();
  try {
    const s = parse(text, name);
    if (token !== S.token) return;
    markPreset(null);
    setStructure(s, null);
    toast(`${name}: ${s.atoms.length.toLocaleString()} atoms, ${s.residues.filter(isPolymer).length.toLocaleString()} residues`);
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* sandboxed */ }
    return true;
  } catch (e) {
    toast(`Could not read ${name}: ${e.message}`, true);
    return false;
  } finally { if (token === S.token) hideLoading(); }
}

// RCSB for 4-character IDs, AlphaFold DB for UniProt accessions
async function fetchId(q) {
  const note = $('fetchNote');
  const id = q.trim().toUpperCase().replace(/^AF-/, '').replace(/-F\d+.*$/, '');
  const say = (msg, cls = '') => { note.textContent = msg; note.className = 'note ' + cls; };
  if (!id) return;
  let urls, label;
  if (/^[0-9][A-Z0-9]{3}$/.test(id)) {
    label = id;
    urls = [`https://files.rcsb.org/download/${id}.cif`, `https://files.rcsb.org/download/${id}.pdb`];
  } else if (UNIPROT.test(id)) {
    label = 'AF-' + id;
    urls = [];
    try {
      const r = await fetch(`https://alphafold.ebi.ac.uk/api/prediction/${id}`);
      if (r.ok) { const j = await r.json(); const e = Array.isArray(j) ? j[0] : j; if (e && e.pdbUrl) urls.push(e.pdbUrl); if (e && e.cifUrl) urls.push(e.cifUrl); }
    } catch (e) { /* fall back to the file names */ }
    for (const v of [6, 5, 4]) urls.push(`https://alphafold.ebi.ac.uk/files/AF-${id}-F1-model_v${v}.pdb`);
  } else {
    say('Enter a 4-character PDB ID (for example 1U19) or a UniProt accession (for example P04637).', 'err');
    return;
  }
  const btn = $('fetchBtn');
  btn.disabled = true;
  say(`Fetching ${label}…`);
  showLoading(`Fetching ${label}…`);
  let lastErr = null;
  for (const u of urls) {
    try {
      const text = await fetchText(u);
      hideLoading();
      if (await loadText(text, label)) { say(`Loaded ${label} from ${new URL(u).host}.`, 'ok'); if (PHONE_Q.matches) setOpen(false); }
      btn.disabled = false;
      return;
    } catch (e) { lastErr = e; }
  }
  hideLoading();
  btn.disabled = false;
  const why = lastErr && /HTTP 404/.test(lastErr.message) ? 'no entry with that ID was found' : navigator.onLine === false ? 'you appear to be offline' : (lastErr ? lastErr.message : 'unknown error');
  say(`Could not fetch ${label}: ${why}. The presets work offline.`, 'err');
  toast(`Could not fetch ${label}: ${why}`, true);
}

// ── structure setup ───────────────────────────────────────────────────────
function resolveSel(sel) {
  const s = S.s, out = [];
  if (!sel) return out;
  if (sel.startsWith('lig:')) { const nm = sel.slice(4); for (const r of s.residues) if (r.name === nm) out.push(r.index); return out; }
  const [ch, rng] = sel.split(':');
  let a = -Infinity, b = Infinity;
  if (rng !== undefined) { const m = rng.split('-'); a = +m[0]; b = m.length > 1 ? +m[1] : a; }
  for (const r of s.residues) if (r.chainId === ch && r.seq >= a && r.seq <= b && r.kind !== 'water') out.push(r.index);
  return out;
}

function setStructure(s, preset) {
  S.s = s; S.preset = preset;
  const polyChains = s.chains.filter(c => c.residues.some(i => isPolymer(s.residues[i])));
  S.rep = preset?.rep || (s.residues.some(isPolymer) ? 'cartoon' : 'ballstick');
  S.color = preset?.color || (s.meta.af ? 'plddt' : polyChains.length > 1 ? 'chain' : 'rainbow');
  S.chainOn = new Uint8Array(s.chains.length).fill(1);
  if (preset?.chains) {
    // the named chains and the het groups that sit on them
    const keep = new Set(preset.chains);
    s.chains.forEach((c, i) => { S.chainOn[i] = keep.has(c.id) || !c.residues.some(ri => isPolymer(s.residues[ri])) ? 1 : 0; });
  }
  S.opacity = preset?.surface ?? 1;
  S.sticks = (preset?.sticks || []).flatMap(resolveSel);
  S.stickSet = new Set(S.sticks);
  S.sel = null; S.hood = new Map(); S.hoverRes = -1;
  S.pending = []; S.measures = []; S.surfCache = null;
  S.fly = null;
  computeFrame();
  const heavy = [];
  for (let i = 0; i < s.atoms.length; i++) if (s.atoms[i].el !== 'H') heavy.push(i);
  S.grid = makeGrid(s.pos, heavy, 5);
  rebuild();
  buildStrip();
  syncUI();
  hideCard();
  resetView(true);
  if (preset?.focus) {
    const rs = resolveSel(preset.focus).filter(ri => S.chainOn[s.residues[ri].chain]);
    if (rs.length) setTimeout(() => {
      if (S.s !== s) return;
      if (rs.length <= 12) {
        select(anchorAtom(s.residues[rs[0]]), { fly: false, scroll: true, ensure: false });
        focusResidues([...rs, ...[...S.hood.keys()].slice(0, 30)], S.rep === 'surface' ? 12 : 5);
      } else focusResidues(rs, 6);
    }, REDUCED ? 0 : 450);
  }
  S.ready = true;
  dirty();
}

// centre on the visible polymer, long axis across (or up on a portrait view)
function computeFrame() {
  const s = S.s;
  const pts = [];
  s.residues.forEach(r => { if (isPolymer(r) && r.ca >= 0 && S.chainOn[r.chain]) pts.push(r.ca); });
  if (pts.length < 3) for (let i = 0; i < s.atoms.length; i++) if (S.chainOn[s.residues[s.atoms[i].res].chain]) pts.push(i);
  const p = s.pos;
  let cx = 0, cy = 0, cz = 0;
  for (const i of pts) { cx += p[3 * i]; cy += p[3 * i + 1]; cz += p[3 * i + 2]; }
  cx /= pts.length; cy /= pts.length; cz /= pts.length;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const i of pts) {
    const d = [p[3 * i] - cx, p[3 * i + 1] - cy, p[3 * i + 2] - cz];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += d[a] * d[b];
  }
  let ax = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (pts.length >= 3) {
    const e = eig3(C);
    let e1 = e[0].vec, e2 = e[1].vec;
    const portrait = canvas.clientHeight > canvas.clientWidth * 1.15;
    if (portrait) [e1, e2] = [e2, e1];
    const e3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    ax = [e1, e2, e3];
  }
  const n = s.atoms.length, w = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const x = p[3 * i] - cx, y = p[3 * i + 1] - cy, z = p[3 * i + 2] - cz;
    w[3 * i] = ax[0][0] * x + ax[0][1] * y + ax[0][2] * z;
    w[3 * i + 1] = ax[1][0] * x + ax[1][1] * y + ax[1][2] * z;
    w[3 * i + 2] = ax[2][0] * x + ax[2][1] * y + ax[2][2] * z;
  }
  S.wpos = w;
}

function select(atom, opts = {}) {
  const s = S.s;
  if (!s || atom < 0) { clearSelection(); return; }
  const ri = s.atoms[atom].res;
  S.sel = { atom, res: ri };
  S.hood = neighbours(ri);
  rebuildOverlay();
  paint();
  showCard();
  stripMark(opts.scroll !== false);
  if (opts.fly) focusResidues([ri], 10);
  else if (opts.ensure !== false) setTimeout(() => ensureVisible(ri), 60);
}
function clearSelection() {
  if (!S.sel) return;
  S.sel = null; S.hood = new Map();
  rebuildOverlay(); paint(); hideCard(); stripMark(false);
}
function stepResidue(dir) {
  if (!S.sel) return;
  const s = S.s, r = s.residues[S.sel.res];
  const list = s.chains[r.chain].residues;
  let k = list.indexOf(r.index);
  for (k += dir; k >= 0 && k < list.length; k += dir) {
    const q = s.residues[list[k]];
    if (q.kind !== 'water') { select(anchorAtom(q), { fly: false }); return; }
  }
}

// ── the card ──────────────────────────────────────────────────────────────
const card = $('card');
function showCard() {
  const s = S.s, sel = S.sel;
  if (!s || !sel) return hideCard();
  const a = s.atoms[sel.atom], r = s.residues[sel.res];
  const full = AA_NAME[r.name] || (r.kind === 'ligand' ? 'Ligand' : r.kind === 'ion' ? 'Ion' : r.kind === 'nucleic' ? 'Nucleotide' : r.name);
  const col = S.resColSRGB ? toHex([S.resColSRGB[3 * r.index], S.resColSRGB[3 * r.index + 1], S.resColSRGB[3 * r.index + 2]]) : '#ffd27a';
  const kind = r.kind === 'protein' ? 'protein' : r.kind;
  const ssTxt = r.kind === 'protein' ? SS_NAME[r.ss] || 'coil' : '';
  const bLabel = s.meta.af ? 'pLDDT' : 'B-factor';
  const bVal = s.meta.af ? `${a.b.toFixed(1)} · ${PLDDT.find(p => a.b > p.min || p.min < 0).label.split(' (')[0].toLowerCase()}` : `${a.b.toFixed(1)} Å²`;
  const nb = [...S.hood.entries()];
  const shown = nb.slice(0, PHONE_Q.matches ? 24 : 18);
  const chip = ([rj, d]) => {
    const q = s.residues[rj];
    const c = S.resColSRGB ? toHex([S.resColSRGB[3 * rj], S.resColSRGB[3 * rj + 1], S.resColSRGB[3 * rj + 2]]) : '#888';
    const ch = q.chain !== r.chain ? `${esc(q.chainId)}:` : '';
    return `<button type="button" data-r="${rj}"><i style="background:${c}"></i>${ch}${esc(resLabel(q))} <span style="color:var(--dim)">${d.toFixed(1)}</span></button>`;
  };
  card.innerHTML = `
    <div class="c-head"><div class="ttl">
      <div class="eyebrow" style="--gc:${col}"><i></i>Chain ${esc(r.chainId)} · ${esc(kind)}${ssTxt ? ' · ' + ssTxt : ''}</div>
      <div class="c-name">${esc(resLabel(r))}<small>${esc(full)}</small></div>
    </div><button class="c-x" type="button" data-act="close" aria-label="Clear selection">✕</button></div>
    <div class="specs">
      <span class="k">Atom</span><span class="v">${esc(a.name)} · ${esc(a.el)}</span>
      <span class="k">${bLabel}</span><span class="v">${bVal}</span>
      <span class="k">Occupancy</span><span class="v">${a.occ.toFixed(2)}</span>
      <span class="k">Atoms</span><span class="v">${r.atoms.length}</span>
    </div>
    <div class="c-sub">Within 5 Å · ${nb.length} residue${nb.length === 1 ? '' : 's'}</div>
    <div class="nb">${shown.map(chip).join('')}${nb.length > shown.length ? `<span class="more">+${nb.length - shown.length} more</span>` : ''}${nb.length ? '' : '<span class="more">none</span>'}</div>
    <div class="c-acts"><button type="button" data-act="prev" aria-label="Previous residue">‹</button><button type="button" data-act="focus">Focus</button><button type="button" data-act="next" aria-label="Next residue">›</button></div>`;
  card.hidden = false;
  document.body.classList.add('has-card');
  dirty();
}
function hideCard() { card.hidden = true; document.body.classList.remove('has-card'); dirty(); }
card.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.r !== undefined) { select(anchorAtom(S.s.residues[+b.dataset.r]), { fly: true }); return; }
  const act = b.dataset.act;
  if (act === 'close') clearSelection();
  else if (act === 'prev') stepResidue(-1);
  else if (act === 'next') stepResidue(1);
  else if (act === 'focus') focusSelection();
});

// ── sequence strip ────────────────────────────────────────────────────────
const seq = $('seq');
function buildStrip() {
  const s = S.s;
  let html = '';
  s.chains.forEach((ch, ci) => {
    const pol = ch.residues.filter(i => isPolymer(s.residues[i]));
    if (!pol.length) return;
    html += `<div class="chn" data-c="${ci}"><span class="chl">${esc(ch.id)}</span>`;
    let last = null;
    for (const ri of pol) {
      const r = s.residues[ri];
      const ssc = r.ss === 'H' || r.ss === 'G' ? ' h' : r.ss === 'E' ? ' e' : '';
      const n = r.seq % 10 === 0 || last === null ? ` data-n="${r.seq}"` : '';
      html += `<span class="aa${ssc}" data-r="${ri}"${n}>${r.code || 'X'}</span>`;
      last = r;
    }
    html += '</div>';
  });
  const het = s.residues.filter(r => r.kind === 'ligand' && !ADDITIVES.has(r.name));
  if (het.length) {
    html += '<div class="chn het"><span class="chl">Het</span>';
    const seen = new Set();
    for (const r of het) {
      const k = r.name + r.chainId;
      if (seen.has(k) || seen.size >= 40) continue;
      seen.add(k);
      html += `<span class="aa lig" data-r="${r.index}" style="width:auto;padding:0 4px">${esc(r.name)}</span>`;
    }
    html += '</div>';
  }
  seq.innerHTML = html;
  S.cells = new Map();
  seq.querySelectorAll('.aa').forEach(el => S.cells.set(+el.dataset.r, el));
  stripColors();
  seq.scrollLeft = 0;
}
function stripColors() {
  const s = S.s;
  const col = residueColors(s, S.color);
  for (const [ri, el] of S.cells) {
    el.style.setProperty('--c', toHex([col[3 * ri], col[3 * ri + 1], col[3 * ri + 2]]));
    el.classList.toggle('off', !S.chainOn[s.residues[ri].chain]);
  }
}
let markedCells = [];
function stripMark(scroll) {
  for (const el of markedCells) el.classList.remove('sel', 'hood');
  markedCells = [];
  if (!S.sel) return;
  const el = S.cells.get(S.sel.res);
  if (el) { el.classList.add('sel'); markedCells.push(el); }
  for (const ri of S.hood.keys()) { const c = S.cells.get(ri); if (c) { c.classList.add('hood'); markedCells.push(c); } }
  if (el && scroll) {
    const sr = seq.getBoundingClientRect(), er = el.getBoundingClientRect();
    if (er.left < sr.left + 40 || er.right > sr.right - 20) seq.scrollTo({ left: seq.scrollLeft + (er.left - sr.left) - sr.width / 2, behavior: REDUCED ? 'auto' : 'smooth' });
  }
}
let seqDown = null;
seq.addEventListener('pointerdown', e => { seqDown = { x: e.clientX, y: e.clientY, sl: seq.scrollLeft }; });
seq.addEventListener('pointerup', e => {
  if (!seqDown) return;
  const moved = Math.abs(e.clientX - seqDown.x) + Math.abs(seq.scrollLeft - seqDown.sl);
  seqDown = null;
  if (moved > 8) return;
  const el = e.target.closest('.aa');
  if (!el) return;
  const r = S.s.residues[+el.dataset.r];
  if (S.measure) { addMeasureAtom(anchorAtom(r)); return; }
  select(anchorAtom(r), { fly: true, scroll: false });
});
seq.addEventListener('pointercancel', () => { seqDown = null; });
seq.addEventListener('wheel', e => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { seq.scrollLeft += e.deltaY; e.preventDefault(); }
}, { passive: false });
if (HOVER) {
  seq.addEventListener('pointerover', e => {
    const el = e.target.closest('.aa');
    const ri = el ? +el.dataset.r : -1;
    if (ri !== S.hoverRes) { S.hoverRes = ri; paint(); }
  });
  seq.addEventListener('pointerleave', () => { if (S.hoverRes >= 0) { S.hoverRes = -1; paint(); } });
}

// ── canvas pointer: tap, double tap, hover ────────────────────────────────
const tip = $('tip');
const downs = new Map();
let multi = false, lastTap = { t: 0, res: -1 };
canvas.addEventListener('pointerdown', e => {
  downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
  if (downs.size > 1) multi = true;
});
const endPointer = e => {
  const d = downs.get(e.pointerId);
  downs.delete(e.pointerId);
  if (!d) return;
  const wasMulti = multi;
  if (!downs.size) multi = false;
  if (e.type === 'pointercancel' || wasMulti) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > (COARSE ? 10 : 6) || performance.now() - d.t > 600) return;
  onTap(e.clientX, e.clientY);
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
function onTap(x, y) {
  const i = pickAt(x, y);
  if (S.measure) { if (i >= 0) addMeasureAtom(i); return; }
  const now = performance.now();
  if (i >= 0) {
    const ri = S.s.atoms[i].res;
    if (now - lastTap.t < 350 && lastTap.res === ri) { focusSelection(); lastTap = { t: 0, res: -1 }; return; }
    lastTap = { t: now, res: ri };
    select(i);
  } else {
    lastTap = { t: 0, res: -1 };
    clearSelection();
  }
}
let mouse = null;
if (HOVER) {
  canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { mouse = { x: e.clientX, y: e.clientY, buttons: e.buttons }; } });
  canvas.addEventListener('pointerleave', () => { mouse = null; setHover(-1); });
}
function setHover(atom, x, y) {
  if (atom < 0) { tip.classList.remove('show'); if (S.hoverRes >= 0) { S.hoverRes = -1; paint(); markHoverCell(); } return; }
  const s = S.s, a = s.atoms[atom], r = s.residues[a.res];
  tip.innerHTML = `${esc(r.chainId)}:${esc(resLabel(r))} <i>· ${esc(a.name)}${s.meta.af ? ' · pLDDT ' + a.b.toFixed(0) : ''}</i>`;
  const cr = canvas.getBoundingClientRect();
  tip.style.transform = `translate(${x - cr.left + 14}px,${y - cr.top + 14}px)`;
  tip.classList.add('show');
  if (r.index !== S.hoverRes) { S.hoverRes = r.index; paint(); markHoverCell(); }
}
let hovCell = null;
function markHoverCell() {
  if (hovCell) hovCell.classList.remove('hov');
  hovCell = S.hoverRes >= 0 ? S.cells.get(S.hoverRes) : null;
  if (hovCell) hovCell.classList.add('hov');
}

// ── camera ────────────────────────────────────────────────────────────────
const occ = { l: 0, r: 0, t: 0, b: 0 };
function occlusion() {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  const cr = canvas.getBoundingClientRect(), w = cr.width, h = cr.height;
  const consider = el => {
    if (!el || el.hidden) return;
    const q = el.getBoundingClientRect();
    const x0 = Math.max(cr.left, q.left), x1 = Math.min(cr.right, q.right), y0 = Math.max(cr.top, q.top), y1 = Math.min(cr.bottom, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) return;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) { if (y0 + y1 > cr.top * 2 + h) o.b = Math.max(o.b, cr.bottom - y0); else o.t = Math.max(o.t, y1 - cr.top); }
    else { if (x0 + x1 < cr.left * 2 + w) o.l = Math.max(o.l, x1 - cr.left); else o.r = Math.max(o.r, cr.right - x0); }
  };
  if (panel.classList.contains('open')) consider(panel);
  consider($('seqWrap'));
  if (PHONE_Q.matches) consider(card);
  return o;
}
function clearRect() {
  const w = canvas.clientWidth, h = canvas.clientHeight, o = occlusion();
  return { x0: o.l, x1: w - o.r, y0: o.t, y1: h - o.b, w, h, o };
}
function fitDist(radius) {
  const c = clearRect();
  const frac = Math.max(0.25, Math.min((c.x1 - c.x0) / c.h, (c.y1 - c.y0) / c.h));
  return (radius / (Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * frac)) * 1.04;
}
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return false;
  const dpr = DPR();
  if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
  const sz = renderer.getSize(new THREE.Vector2());
  if (sz.x !== w || sz.y !== h) renderer.setSize(w, h, false);
  post.setSize(w, h, dpr);
  camera.aspect = w / h;
  camera.setViewOffset(w, h, (occ.l - occ.r) / -2, (occ.t - occ.b) / -2, w, h);
  camera.updateProjectionMatrix();
  return true;
}
function flyTo(target, dist, dur = 0.9) {
  S.fly = { t: 0, dur: REDUCED ? 0.01 : dur, t0: controls.target.clone(), t1: target.clone(), d0: camera.position.distanceTo(controls.target), d1: dist };
  dirty();
}
function resetView(instant) {
  S.fly = null;
  const d = fitDist(S.bound.r);
  controls.target.copy(S.bound.c);
  camera.up.set(0, 1, 0);
  camera.position.set(S.bound.c.x, S.bound.c.y, S.bound.c.z + d);
  camera.lookAt(controls.target);
  controls.maxDistance = Math.max(80, S.bound.r * 10);
  controls.minDistance = 2;
  if (!instant) { const t = S.bound.c.clone(); camera.position.z += d * 0.25; flyTo(t, d, 0.6); }
  controls.update();
  dirty();
}
function focusResidues(list, pad = 8) {
  const s = S.s, c = new THREE.Vector3();
  let n = 0;
  for (const ri of list) for (const i of s.residues[ri].atoms) { c.add(atomPos(i)); n++; }
  if (!n) return;
  c.multiplyScalar(1 / n);
  let r = 0;
  for (const ri of list) for (const i of s.residues[ri].atoms) r = Math.max(r, atomPos(i).distanceTo(c));
  flyTo(c, fitDist(Math.min(r + pad, S.bound.r)));
}
function focusSelection() {
  if (!S.sel) { resetView(false); return; }
  focusResidues([S.sel.res, ...[...S.hood.keys()].slice(0, 30)], 3);
}
// pan to a picked residue that sits under the card, the strip or the panel
function ensureVisible(ri) {
  const s = S.s;
  if (!s || !S.sel) return;
  const p = atomPos(anchorAtom(s.residues[ri])).project(camera);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const x = (p.x + 1) / 2 * w, y = (1 - p.y) / 2 * h;
  const cr = canvas.getBoundingClientRect();
  const blocked = [card, $('seqWrap'), panel.classList.contains('open') ? panel : null].some(el => {
    if (!el || el.hidden) return false;
    const q = el.getBoundingClientRect();
    return x + cr.left > q.left - 16 && x + cr.left < q.right + 16 && y + cr.top > q.top - 16 && y + cr.top < q.bottom + 16;
  });
  if (blocked || x < 8 || x > w - 8 || y < 8 || y > h - 8) flyTo(atomPos(anchorAtom(s.residues[ri])), camera.position.distanceTo(controls.target), 0.7);
}

// ── panel, sheet, dock ────────────────────────────────────────────────────
const panel = $('panel'), dockPanel = $('dockPanel');
function setOpen(open) {
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  document.body.classList.toggle('sheet-open', open);
  dockPanel.classList.toggle('on', open);
  dockPanel.setAttribute('aria-expanded', String(open));
  dirty();
}
$('gear').addEventListener('click', () => setOpen(true));
dockPanel.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
$('panelClose').addEventListener('click', () => setOpen(false));
setOpen(!PHONE_Q.matches);
PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
const grip = $('sheetGrip');
let gripY = null;
grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* old browsers */ } });
grip.addEventListener('pointerup', e => {
  if (gripY === null) return;
  const dy = e.clientY - gripY; gripY = null;
  if (Math.abs(dy) < 8) panel.classList.toggle('full');
  else if (dy < -40) panel.classList.add('full');
  else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  dirty();
});
grip.addEventListener('pointercancel', () => { gripY = null; });

function markPreset(id) {
  document.querySelectorAll('.pc').forEach(b => b.classList.toggle('on', b.dataset.id === id));
}
function buildUI() {
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
async function loadFile(f) {
  if (f.size > 120e6) { toast('That file is over 120 MB, which is too large to show here', true); return; }
  try {
    const text = await decodeBytes(new Uint8Array(await f.arrayBuffer()));
    if (await loadText(text, f.name.replace(/\.(gz)$/i, '').replace(/\.(pdb|ent|cif|mmcif|txt)$/i, '')) && PHONE_Q.matches) setOpen(false);
  } catch (e) { toast(`Could not read ${f.name}: ${e.message}`, true); }
}
function setRep(id) {
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
function setColor(id) {
  if (!S.s) return;
  S.color = id;
  syncUI(); paint(); stripColors();
  if (S.sel) showCard();
  toastIf(`Colour: ${SCHEMES.find(c => c.id === id).label}`);
}
const toastIf = msg => { if (PHONE_Q.matches && !panel.classList.contains('open')) toast(msg); };

function syncUI() {
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

// drag and drop a file anywhere
let dragDepth = 0;
window.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; $('drop').hidden = false; e.preventDefault(); } });
window.addEventListener('dragover', e => { if (!$('drop').hidden) e.preventDefault(); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
window.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('drop').hidden = true;
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadFile(f);
});
window.addEventListener('resize', dirty);
window.addEventListener('keydown', e => {
  if (e.target.closest('input,textarea')) return;
  if (e.key === 'Escape') { if (S.measure) setMeasure(0); else clearSelection(); }
  else if (e.key === 'f') focusSelection();
  else if (e.key === 'r') resetView(false);
  else if (e.key === '[' || e.key === ',') stepResidue(-1);
  else if (e.key === ']' || e.key === '.') stepResidue(1);
});

// ── loop ──────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  // framing eases toward the clear area
  const o = occlusion();
  for (const k in occ) {
    const d = o[k] - occ[k];
    if (Math.abs(d) > 0.5) { occ[k] += d * Math.min(1, dt * 9); S.dirty = true; } else if (d) { occ[k] = o[k]; S.dirty = true; }
  }
  if (S.fly) {
    const f = S.fly;
    f.t = Math.min(1, f.t + dt / f.dur);
    const k = ease(f.t);
    const dir = camera.position.clone().sub(controls.target).normalize();
    controls.target.lerpVectors(f.t0, f.t1, k);
    camera.position.copy(controls.target).addScaledVector(dir, f.d0 + (f.d1 - f.d0) * k);
    if (f.t >= 1) S.fly = null;
    S.dirty = true;
  }
  controls.autoRotate = S.spin && !S.fly;
  if (controls.update(dt)) S.dirty = true;
  if (S.spin) S.dirty = true;
  // hover pick, once a frame, when the mouse is still
  if (mouse && !mouse.buttons && S.s && !S.measure) {
    const m = mouse; mouse = null;
    const i = pickAt(m.x, m.y, 4);
    setHover(i, m.x, m.y);
  }
  if (!S.dirty) return;
  S.dirty = false;
  if (!resize()) return;
  // near and far planes round the molecule; fog round the camera target
  const dC = camera.position.distanceTo(S.bound.c), dT = camera.position.distanceTo(controls.target);
  camera.near = Math.max(0.2, dC - S.bound.r * 1.6);
  camera.far = dC + S.bound.r * 1.6 + 20;
  camera.updateProjectionMatrix();
  const Rf = Math.max(8, Math.min(S.bound.r, dT * 0.6));
  post.render(scene, camera, [dT - Rf * 0.15, dT + Rf * 1.25]);
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(overlay, camera);
  renderer.autoClear = true;
  placeLabels();
  S.frames++;
}

window.addEventListener('pagehide', () => {
  running = false; cancelAnimationFrame(raf);
  try {
    clearGroup(mol); clearGroup(over); clearGroup(overlay);
    R.disposeGeoCache(); post.dispose(); envRT.dispose();
    for (const m of [matAtom, matCartoon, matSurface, matMark, ...Object.values(matLine)]) m.dispose();
    controls.dispose(); renderer.dispose(); renderer.forceContextLoss();
  } catch (e) { /* the page is going */ }
});

// debug and headless checks
window.__pv = { S, loadPreset, select, clearSelection, setRep, setColor, setMeasure, addMeasureAtom, pickAt, resolveSel, camera, controls, PRESETS, setOpen, focusSelection, resetView, fetchId };

// ── boot ──────────────────────────────────────────────────────────────────
buildUI();
syncUI();
const start = decodeURIComponent((location.hash || '').slice(1));
loadPreset(byId(start) ? start : 'rhodopsin');
requestAnimationFrame(frame);
