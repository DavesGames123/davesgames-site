// ============================================================================
//  MOLECULE EXPLORER  ·  main.js — state, panel, linking, compare, export
// ────────────────────────────────────────────────────────────────────────────
//  Two sides: 'a' (always on) and 'b' (the compare row). Each side has a
//  2D pane (pane2d.js) and a 3D view (view3d.js) of the same model, and the
//  hover and the selection of a side light the same atoms in both views.
//  The URL hash names the molecule (#caffeine, #cid-2519) so a link opens it.
//
//  grep -n targets
//    boot ............ "async function boot"
//    a side .......... "function makeSide"
//    load ............ "function show("
//    linking ......... "function linkHover" "function linkPick"
//    info panel ...... "function renderInfo"
//    groups .......... "function applyGroups"
//    search .......... "function runQuery" "function renderResults"
//    compare ......... "function setCompare"
//    morph ........... "function openLewis" "function drawLift" (drawlift.js)
//    export .......... "function exportAs"
//    phone sheet ..... "function setOpen" "function occlusion"
//    frame loop ...... "function frame"
// ============================================================================
import { View3D } from './view3d.js';
import { Pane2D, MORPH } from './pane2d.js';
import { LIB, loadLibrary, model, search, isomers, thumb, Browser, addRecord } from './browse.js';
import { findGroups, GROUP_INFO, CAT_NAME, formulaHTML, toMolfile, toSDF, el, lonePairs } from './chem.js';
import { timingFor, drawLiftAt } from './drawlift.js';

const $ = id => document.getElementById(id);
const REDUCED_Q = window.matchMedia('(prefers-reduced-motion: reduce)');
const PHONE_Q = window.matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const STYLES = [['ball', 'Ball'], ['space', 'Space'], ['stick', 'Stick'], ['wire', 'Wire']];
const ELNAME = { H: 'hydrogen', C: 'carbon', N: 'nitrogen', O: 'oxygen', F: 'fluorine', P: 'phosphorus', S: 'sulfur', Cl: 'chlorine', Br: 'bromine', I: 'iodine',
  B: 'boron', Si: 'silicon', Se: 'selenium', Na: 'sodium', K: 'potassium', Mg: 'magnesium', Ca: 'calcium', Fe: 'iron', Co: 'cobalt', Ni: 'nickel', Cu: 'copper',
  Zn: 'zinc', Pt: 'platinum', Pd: 'palladium', Ru: 'ruthenium', Rh: 'rhodium', Ti: 'titanium', Cr: 'chromium', Mn: 'manganese', Hg: 'mercury', Pb: 'lead',
  Xe: 'xenon', Kr: 'krypton', Ar: 'argon', Ne: 'neon', He: 'helium', Li: 'lithium', Al: 'aluminium', As: 'arsenic', Sn: 'tin', Os: 'osmium', Ir: 'iridium', U: 'uranium' };

export const S = { style: 'ball', h2: false, h3: true, color: true, labels: 'none', spin: false, groups: false, groupFocus: null, compare: false, lewis: false };
const sides = {};
let browser = null;

// ── a side: 2D pane + 3D view ───────────────────────────────────────────────
function makeSide(key) {
  const p2 = document.querySelector(`.pane[data-k=${key}2]`), p3 = document.querySelector(`.pane[data-k=${key}3]`);
  const side = { key, p2, p3, rec: null, M: null, hover: null, sel: null, groups: [] };
  side.pane = new Pane2D(p2.querySelector('.svgwrap'), {
    onHover: hit => linkHover(side, hit),
    onPick: (hit, type) => linkPick(side, hit, type),
  });
  side.tip = p2.querySelector('.atomtip');
  try {
    side.view = new View3D(p3.querySelector('canvas'), { labels: p3.querySelector('.labels3') });
  } catch (e) { $('nogl').hidden = false; side.view = null; }
  if (side.view) bind3D(side);
  return side;
}
function bind3D(side) {
  const cv = side.view.canvas;
  let down = null;
  cv.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    const hit = side.view.pickAt(e.clientX, e.clientY);
    const k = hit ? JSON.stringify(hit) : '';
    if (k !== side._h3) { side._h3 = k; linkHover(side, hit); }
  });
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { side._h3 = ''; linkHover(side, null); } });
  cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; side.view.setSpin(false); });
  cv.addEventListener('pointerup', e => {
    if (!down) return;
    const d = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (d < 6 && performance.now() - down.t < 600) linkPick(side, side.view.pickAt(e.clientX, e.clientY), e.pointerType);
    down = null;
    if (S.spin) setTimeout(() => side.view && side.view.setSpin(S.spin), 1500);
  });
}

// ── load ───────────────────────────────────────────────────────────────────
function show(sideKey, rec, opts = {}) {
  const side = sides[sideKey];
  if (!rec) return;
  stopLewis();
  side.rec = rec; side.M = model(rec); side.hover = null; side.sel = null;
  side.groupsAll = findGroups(side.M);
  side.pane.state.color = S.color;
  Object.assign(side.pane.state, S.h2 ? { hC: 1, hX: 1, cL: 0, lp: 0 } : { hC: 0, hX: 0, cL: 0, lp: 0 });
  side.pane.setModel(side.M);
  if (side.view) {
    side.view.showH = S.h3; side.view.style = S.style; side.view.labelMode = S.labels;
    side.view.morph = 1; side.view.reveal = null; side.view.ink = 0;
    side.view.setModel(side.M); side.view.setSpin(S.spin);
    // each molecule that loads draws itself, then lifts into 3D (not in
    // the saver, which runs its own, or with reduced motion)
    if (!opts.noAnim && !REDUCED_Q.matches && !document.documentElement.classList.contains('sn-saver')) drawLift(side);
    side.p3.querySelector('.src3').textContent = rec.g3 === 'ocl' ? '3D: OpenChemLib conformer (MMFF94s+)' : rec.g3 === 'built' ? '3D: built geometry' : '3D: PubChem conformer';
  }
  applyGroups(side);
  if (sideKey === 'a') {
    renderInfo(rec, side.M);
    if (!opts.noHash) { try { history.replaceState(null, '', '#' + rec.id); } catch (e) { /* file: */ } }
    document.title = `${rec.n} — Molecule Explorer · Stella Nova`;
  } else {
    side.p3.querySelector('.cmpname').textContent = rec.n;
    side.p2.querySelector('.pt').textContent = rec.n;
  }
  side.p2.querySelector('.pt').title = rec.n;
  updateTip(side);
}

// ── linking ────────────────────────────────────────────────────────────────
function itemSet(M, hit) {
  if (!hit) return null;
  if (hit.atom != null) return { atoms: [hit.atom], bonds: [] };
  const b = M.bonds[hit.bond];
  return b ? { atoms: [], bonds: [hit.bond] } : null;
}
function linkHover(side, hit) {
  if (!side.M) return;
  side.hover = hit;
  const set = itemSet(side.M, hit);
  side.pane.set({ hover: set });
  if (side.view) { side.view.setHighlight({ hover: set }); side.view.setMeasure(hit || side.sel); }
  updateTip(side);
}
function linkPick(side, hit, type) {
  if (!side.M) return;
  if (!hit) { side.sel = null; if (type !== 'mouse') side.hover = null; }
  else side.sel = (side.sel && JSON.stringify(side.sel) === JSON.stringify(hit)) ? null : hit;
  const set = itemSet(side.M, side.sel);
  side.pane.set({ sel: set, hover: type === 'mouse' ? side.pane.state.hover : null });
  if (side.view) { side.view.setHighlight({ sel: set, hover: type === 'mouse' ? side.view.hl.hover : null }); side.view.setMeasure(side.sel); }
  updateTip(side);
}
function describe(M, hit) {
  if (hit.atom != null) {
    const i = hit.atom, sym = el(M.z[i]).sym;
    if (i >= M.n) { const p = M.nb[i][0].to; return `<b>H</b> hydrogen on ${el(M.z[p]).sym}${p + 1}`; }
    const h = M.hOf[i].length, deg = M.nb[i].filter(e => e.to < M.n).length, lp = lonePairs(M, i), q = M.q[i];
    const ring = M.rings.filter(r => r.atoms.includes(i)), ar = ring.some(r => r.arom);
    return `<b>${sym}${i + 1}</b> ${ELNAME[sym] || sym}` + (q ? ` · charge ${q > 0 ? '+' : '−'}${Math.abs(q) > 1 ? Math.abs(q) : ''}` : '') +
      ` · ${deg} heavy-atom bond${deg === 1 ? '' : 's'} · ${h} H` + (lp ? ` · ${lp} lone pair${lp > 1 ? 's' : ''}` : '') + (ring.length ? ar ? ' · aromatic ring' : ' · in a ring' : '');
  }
  const b = M.bonds[hit.bond], A = el(M.z[b.a]).sym, B = el(M.z[b.b]).sym;
  const kind = b.ar ? 'aromatic' : ['', 'single', 'double', 'triple'][b.o] || 'single';
  let len = '';
  if (M.xyz) len = ' · ' + Math.hypot(M.xyz[3 * b.a] - M.xyz[3 * b.b], M.xyz[3 * b.a + 1] - M.xyz[3 * b.b + 1], M.xyz[3 * b.a + 2] - M.xyz[3 * b.b + 2]).toFixed(3) + ' Å';
  const st = b.s === 1 ? ' · wedge (toward you)' : b.s === 2 ? ' · hash (away from you)' : '';
  return `<b>${A}${b.a + 1}–${B}${b.b + 1}</b> ${kind} bond${len}${st}`;
}
function updateTip(side) {
  const hit = side.hover || side.sel;
  if (!hit || !side.M) { side.tip.hidden = true; return; }
  side.tip.innerHTML = describe(side.M, hit);
  side.tip.hidden = false;
}

// ── groups ─────────────────────────────────────────────────────────────────
function applyGroups(side) {
  if (!side.M) return;
  const list = S.groups ? side.groupsAll.filter(g => !S.groupFocus || g.id === S.groupFocus) : [];
  side.groups = list.map(g => ({ atoms: g.atoms, color: GROUP_INFO[g.id].color }));
  side.pane.set({ groups: side.groups });
  if (side.view) side.view.setHighlight({ groups: side.groups });
  if (side.key === 'a') renderGroupList(side);
}
function renderGroupList(side) {
  const box = $('groupList'), counts = new Map();
  for (const g of side.groupsAll) counts.set(g.id, (counts.get(g.id) || 0) + 1);
  if (!counts.size) { box.innerHTML = '<div class="gl none">No groups from the list in this molecule.</div>'; return; }
  box.innerHTML = [...counts].map(([id, n]) => `<button type="button" class="gl ${S.groups && (!S.groupFocus || S.groupFocus === id) ? 'on' : ''}" data-g="${id}"><i style="background:${GROUP_INFO[id].color}"></i>${GROUP_INFO[id].name}<small>${n}</small></button>`).join('');
}

// ── info ───────────────────────────────────────────────────────────────────
function renderInfo(rec, M) {
  const p = M.props || {};
  const arom = M.rings.filter(r => r.arom).length;
  const stereoAtoms = [...new Set(M.bonds.filter(b => b.s === 1 || b.s === 2).map(b => b.a))];
  const iso = isomers(rec).slice(0, 14);
  const fmt = (v, d) => v == null || Number.isNaN(v) ? '–' : typeof v === 'number' && d != null ? v.toFixed(d) : v;
  const rows = [
    ['Atoms', `${M.N} (${M.n} heavy${M.N - M.n ? `, ${M.N - M.n} H` : ''})`],
    ['Bonds', M.bonds.length],
    ['Rings', M.rings.length ? `${M.rings.length}${arom ? ` (${arom} aromatic)` : ''}` : '0'],
    ['H-bond donors', fmt(p.hbd)], ['H-bond acceptors', fmt(p.hba)], ['Rotatable bonds', fmt(p.rot)],
    ['logP (estimate)', fmt(p.logP, 2)], ['Polar surface area', p.tpsa == null ? '–' : p.tpsa.toFixed(1) + ' Å²'],
    ['Stereocentres', fmt(p.stereo)],
  ];
  if (rec.cid) rows.push(['PubChem CID', `<a href="https://pubchem.ncbi.nlm.nih.gov/compound/${rec.cid}" target="_blank" rel="noopener" style="color:var(--tone)">${rec.cid}</a>`]);
  $('info').innerHTML = `
    <button type="button" class="i-cat" data-c="${esc(rec.c)}">${esc(CAT_NAME[rec.c] || rec.c)}${rec.fam ? ' · famous' : ''}</button>
    <h1 class="i-name">${esc(rec.n)}</h1>
    <div class="i-form">${formulaHTML(rec.f)}<span class="i-mw">${(+rec.w).toFixed(2)} g/mol</span></div>
    ${rec.d ? `<p class="i-desc">${esc(rec.d)}${rec.dn ? ` ${esc(rec.dn)}` : ''}</p>` : ''}
    ${rec.iu ? `<div class="i-iu"><b>IUPAC</b> ${esc(rec.iu)}</div>` : ''}
    ${rec.s ? `<div class="i-smi"><code id="smi">${esc(rec.s)}</code><button type="button" id="bCopy">Copy</button></div>` : ''}
    <table class="readout">${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>
    ${stereoAtoms.length ? `<div class="chips" style="margin-top:8px"><button type="button" id="bStereo">Show the wedge atoms (${stereoAtoms.length})</button></div>` : ''}
    ${rec.sy && rec.sy.length ? `<div class="i-sub">Also known as</div><div class="syn">${rec.sy.map(esc).join(' · ')}</div>` : ''}
    ${iso.length ? `<div class="i-sub">Same formula in the library</div><div class="chips" id="isoChips">${iso.map(x => `<button type="button" data-id="${x.id}">${esc(x.n)}</button>`).join('')}</div>` : ''}`;
  const cp = $('bCopy');
  if (cp) cp.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(rec.s).then(() => toast('SMILES copied')).catch(() => toast('Copy failed', true)); };
  const st = $('bStereo');
  if (st) st.onclick = () => { const a = sides.a; a.sel = null; const set = { atoms: stereoAtoms, bonds: [] }; a.pane.set({ sel: set }); a.view && a.view.setHighlight({ sel: set }); };
  const ic = $('isoChips');
  if (ic) ic.onclick = e => { const b = e.target.closest('button'); if (b) { if (S.compare) show('b', LIB.byId.get(b.dataset.id)); else show('a', LIB.byId.get(b.dataset.id)); } };
  $('info').querySelector('.i-cat').onclick = () => openBrowse(rec.c);
}

// ── search ─────────────────────────────────────────────────────────────────
let resIdx = -1, resList = [];
function renderResults(q) {
  const box = $('results');
  resList = q.trim() ? search(q, 24) : [];
  resIdx = resList.length ? 0 : -1;
  if (!q.trim()) { box.hidden = true; return; }
  const smilesLike = /[=#()\[\]@\/\\]/.test(q) || /^[A-Za-z0-9]+$/.test(q) && /[a-z]/.test(q) && /^[CNOcnosSPFIBrl0-9]+$/.test(q) && q.length > 3;
  box.innerHTML = resList.map((x, i) => `<button type="button" class="res ${i === resIdx ? 'on' : ''}" data-id="${x.id}"><span class="th">${thumb(x)}</span><span class="tx"><b>${esc(x.n)}</b><small>${formulaHTML(x.f)} · <i>${esc(CAT_NAME[x.c] || '')}</i></small></span></button>`).join('')
    + `<button type="button" class="res act" data-act="smiles"><span class="tx"><b>${smilesLike ? 'Build' : 'Build as SMILES'}: ${esc(q.trim().slice(0, 40))}</b><small>OpenChemLib parses it, lays out the 2D and makes a 3D conformer</small></span></button>`
    + `<button type="button" class="res act" data-act="pubchem"><span class="tx"><b>Look up “${esc(q.trim().slice(0, 40))}” at PubChem</b><small>Name, CID or SMILES; the 3D conformer when PubChem has one</small></span></button>`;
  box.hidden = false;
}
async function runQuery(kind, q) {
  q = q.trim(); if (!q) return;
  $('results').hidden = true;
  loading(kind === 'pubchem' ? 'Asking PubChem' : 'Building the molecule');
  try {
    const eng = await import('./engine.js');
    const rec = kind === 'pubchem' ? await eng.fromPubChem(q) : await eng.fromSmiles(q);
    const known = rec.cid && LIB.recs.find(x => x.cid === rec.cid);
    if (known) { show('a', known); toast(`${known.n} is in the library`); }
    else { addRecord(rec); show('a', rec); toast(kind === 'pubchem' ? `Loaded ${rec.n} from PubChem` : 'Built from SMILES'); }
  } catch (e) {
    toast((kind === 'pubchem' ? 'PubChem: ' : 'SMILES: ') + (e && e.message ? e.message : 'failed'), true);
  } finally { loading(null); }
}

// ── compare ────────────────────────────────────────────────────────────────
function setCompare(on, rec) {
  S.compare = on;
  document.body.classList.toggle('compare', on);
  for (const p of document.querySelectorAll('.pane.cmp')) p.hidden = !on;
  $('bCompare').classList.toggle('on', on);
  if (on) {
    if (!sides.b) sides.b = makeSide('b');
    const a = sides.a.rec;
    const pick = rec || isomers(a)[0] || LIB.recs.filter(x => x.c === a.c && x !== a)[Math.floor(Math.random() * 20)] || LIB.recs[0];
    show('b', pick);
  } else if (sides.b) {
    // free the second WebGL context
    sides.b.view && sides.b.view.dispose();
    sides.b.pane.dispose();
    delete sides.b;
  }
  occlusion();
}

// ── Lewis morph and lift ───────────────────────────────────────────────────
function openLewis() {
  const side = sides.a, cap = $('morphCap');
  if (S.lewis) { stopLewis(); return; }
  S.lewis = true;
  side.p2.querySelector('.paper').appendChild(cap);
  cap.hidden = false;
  cap.querySelector('.mc-steps').innerHTML = MORPH.map((m, k) => `<button type="button" data-k="${k}">${m.name}</button>`).join('');
  const mark = k => { cap.querySelector('b').textContent = MORPH[k].name; cap.querySelector('span').textContent = MORPH[k].text; cap.querySelectorAll('.mc-steps button').forEach((b, i) => b.classList.toggle('on', i === k)); };
  cap.querySelector('.mc-steps').onclick = e => { const b = e.target.closest('button'); if (!b) return; side.pane.stopMorph(); mark(+b.dataset.k); side.pane.setStage(+b.dataset.k); };
  document.querySelectorAll('[data-t=lewis]').forEach(b => b.classList.add('on'));
  $('bLewis').classList.add('on');
  side.pane.playMorph(mark);
}
function stopLewis() {
  if (!S.lewis) return;
  S.lewis = false;
  $('morphCap').hidden = true;
  document.querySelectorAll('[data-t=lewis]').forEach(b => b.classList.remove('on'));
  $('bLewis').classList.remove('on');
  const p = sides.a.pane; p.stopMorph();
  Object.assign(p.state, S.h2 ? { hC: 1, hX: 1, cL: 0, lp: 0 } : { hC: 0, hX: 0, cL: 0, lp: 0 }); p.render();
}
// The skeletal formula draws itself bond by bond as thin ink, face on,
// then lifts into 3D while the ink grows into the chosen style and the
// camera eases from the drawing's frame to the 3D fit (drawlift.js). A new
// molecule or the saver stops a running one; a drag of the view keeps the
// animation but stops the camera move.
function drawLift(side) {
  const v = side.view; if (!v || !side.M) return;
  const tok = side.liftTok = (side.liftTok || 0) + 1, D = timingFor();
  const nb = side.M.nShown;
  v.setSpin(false); v.setReveal(0); v.setInk(1); v.setMorph(0);
  v.fit(true);
  const d0 = v.camera.position.length();
  v.morph = 1; v.fit(false); const d1 = v.camera.position.length(); v.morph = 0;
  v.camera.position.setLength(d0); v.dirty = true;
  const ease = u => u * u * (3 - 2 * u), t0 = performance.now();
  let user = false;
  const stopUser = () => { user = true; };
  v.controls.addEventListener('start', stopUser);
  const end = () => {
    v.controls.removeEventListener('start', stopUser);
    if (side.liftTok !== tok) return;
    v.setReveal(null); v.setInk(0); v.setMorph(1); v.setSpin(S.spin);
  };
  const step = now => {
    if (side.liftTok !== tok || document.documentElement.classList.contains('sn-saver')) { end(); return; }
    const st = drawLiftAt((now - t0) / 1000, nb, D);
    v.setReveal(st.reveal); v.setInk(st.ink); v.setMorph(st.morph);
    // the camera follows the lift unless the user has taken it
    if (!user) { v.camera.position.setLength(d0 + (d1 - d0) * ease(st.morph)); v.dirty = true; }
    if (st.done) { end(); return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ── export ─────────────────────────────────────────────────────────────────
function download(name, blobOrUrl) {
  const a = document.createElement('a');
  a.href = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function exportAs(kind) {
  const side = sides.a, rec = side.rec, M = side.M; if (!rec) return;
  const base = rec.id || 'molecule';
  if (kind === 'svg') download(base + '.svg', new Blob([side.pane.svgText({ groups: S.groups, background: '#ffffff' })], { type: 'image/svg+xml' }));
  else if (kind === 'png2') {
    const svg = side.pane.svgText({ groups: S.groups, width: 1600, background: '#ffffff' });
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth || 1600; c.height = img.naturalHeight || 1200;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    c.toBlob(b => download(base + '-2d.png', b), 'image/png');
  } else if (kind === 'png3' && side.view) download(base + '-3d.png', side.view.toPNG(2));
  else if (kind === 'glb' && side.view) download(base + '.glb', side.view.toGLB());
  else if (kind === 'mol') download(base + '.mol', new Blob([toMolfile(M)], { type: 'chemical/x-mdl-molfile' }));
  else if (kind === 'sdf') download(base + '.sdf', new Blob([toSDF(M)], { type: 'chemical/x-mdl-sdfile' }));
}

// ── UI helpers ─────────────────────────────────────────────────────────────
let toastT = 0;
function toast(msg, err) { const t = $('toast'); t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
function loading(msg) { $('loading').hidden = !msg; if (msg) $('loadingText').textContent = msg; }
function openBrowse(cat) { browser.open(cat); $('dockBrowse').classList.add('on'); if (PHONE_Q.matches) setOpen(false); }
function closeBrowse() { browser.close(); $('dockBrowse').classList.remove('on'); }
function random() { const r = LIB.recs[Math.floor(Math.random() * LIB.recs.length)]; show('a', r); }
function setStyle(s) {
  S.style = s;
  document.querySelectorAll('.st3 button').forEach(b => b.classList.toggle('on', b.dataset.s === s));
  $('dockStyleV').textContent = STYLES.find(x => x[0] === s)[1];
  for (const k in sides) sides[k].view && sides[k].view.setStyle(s);
}
function setGroups(on, focus = null) {
  S.groups = on; S.groupFocus = focus;
  $('bGroups').classList.toggle('on', on); $('dockGroups').classList.toggle('on', on);
  for (const k in sides) applyGroups(sides[k]);
}

// ── phone sheet ────────────────────────────────────────────────────────────
function setOpen(open) {
  const panel = $('panel');
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  $('dockPanel').classList.toggle('on', open);
  $('dockPanel').setAttribute('aria-expanded', String(open));
  occlusion();
}
// The stage ends where the sheet begins (portrait) or the drawer begins
// (landscape), so both panes stay in view with the panel open.
function occlusion() {
  const root = document.documentElement.style;
  if (!PHONE_Q.matches) { root.setProperty('--occ-b', '0px'); root.setProperty('--occ-r', '0px'); return; }
  const panel = $('panel'), open = panel.classList.contains('open');
  const dock = $('dock').getBoundingClientRect().height;
  const land = window.matchMedia('(max-height:500px) and (orientation:landscape) and (pointer:coarse)').matches;
  if (land) { root.setProperty('--occ-b', dock + 'px'); root.setProperty('--occ-r', open ? panel.getBoundingClientRect().width + 'px' : '0px'); return; }
  root.setProperty('--occ-r', '0px');
  const full = panel.classList.contains('full');
  // a full sheet covers the stage; then the panes keep a minimum height
  const h = open ? (full ? Math.min(panel.offsetHeight, innerHeight * 0.5) : panel.offsetHeight) : 0;
  root.setProperty('--occ-b', (dock + h) + 'px');
}

// ── frame loop ─────────────────────────────────────────────────────────────
let last = performance.now(), running = true;
function frame(now) {
  if (!running) return;
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  for (const k in sides) sides[k].view && sides[k].view.frame(dt);
}

// ── boot ───────────────────────────────────────────────────────────────────
function wire() {
  // pane tools
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    const pane = b.closest('.pane'), key = pane ? pane.dataset.k[0] : 'a', side = sides[key];
    const t = b.dataset.t;
    if (t === 'zin') side.pane.zoomAt(1.3); else if (t === 'zout') side.pane.zoomAt(1 / 1.3); else if (t === 'fit') side.pane.fit();
    else if (t === 'lewis') openLewis();
    else if (t === 'h2') { S.h2 = !S.h2; stopLewis(); document.querySelectorAll('[data-t=h2]').forEach(x => x.classList.toggle('on', S.h2)); for (const k in sides) { Object.assign(sides[k].pane.state, S.h2 ? { hC: 1, hX: 1 } : { hC: 0, hX: 0 }); sides[k].pane.render(); sides[k].pane.fit(); } }
    else if (t === 'color') { S.color = !S.color; document.querySelectorAll('[data-t=color]').forEach(x => x.classList.toggle('on', S.color)); for (const k in sides) sides[k].pane.set({ color: S.color }); }
    else if (t === 'h3') { S.h3 = !S.h3; document.querySelectorAll('[data-t=h3]').forEach(x => x.classList.toggle('on', S.h3)); for (const k in sides) sides[k].view && sides[k].view.setShowH(S.h3); }
    else if (t === 'lab') { S.labels = { none: 'hetero', hetero: 'all', all: 'none' }[S.labels]; b.textContent = { none: 'Labels', hetero: 'Labels: N O S', all: 'Labels: all' }[S.labels]; for (const k in sides) sides[k].view && sides[k].view.setLabels(S.labels); }
    else if (t === 'spin') { S.spin = !S.spin; document.querySelectorAll('[data-t=spin]').forEach(x => x.classList.toggle('on', S.spin)); for (const k in sides) sides[k].view && sides[k].view.setSpin(S.spin); }
    else if (t === 'lift') { for (const k in sides) drawLift(sides[k]); }
    else if (t === 'reset') { for (const k in sides) sides[k].view && sides[k].view.fit(true); }
    else if (t === 'cmpx') setCompare(false);
  });
  document.querySelector('.st3').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setStyle(b.dataset.s); });
  // search
  const q = $('q');
  q.addEventListener('input', () => renderResults(q.value));
  q.addEventListener('focus', () => { if (q.value.trim()) renderResults(q.value); });
  q.addEventListener('keydown', e => {
    const items = [...$('results').querySelectorAll('.res')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); resIdx = Math.max(0, Math.min(items.length - 1, resIdx + (e.key === 'ArrowDown' ? 1 : -1))); items.forEach((x, i) => x.classList.toggle('on', i === resIdx)); items[resIdx] && items[resIdx].scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[resIdx];
      if (it && it.dataset.id) { show('a', LIB.byId.get(it.dataset.id)); $('results').hidden = true; q.blur(); }
      else if (it && it.dataset.act) runQuery(it.dataset.act, q.value);
      else runQuery(/[=#()\[\]@]/.test(q.value) ? 'smiles' : 'pubchem', q.value);
    } else if (e.key === 'Escape') { $('results').hidden = true; q.blur(); }
  });
  $('results').addEventListener('click', e => {
    const b = e.target.closest('.res'); if (!b) return;
    if (b.dataset.id) { show('a', LIB.byId.get(b.dataset.id)); $('results').hidden = true; if (PHONE_Q.matches) setOpen(false); }
    else runQuery(b.dataset.act, q.value);
  });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.searchbox')) $('results').hidden = true; });
  // compare search
  document.addEventListener('keydown', e => {
    if (e.target.classList && e.target.classList.contains('cmpq') && e.key === 'Enter') { const r = search(e.target.value, 1)[0]; if (r) { show('b', r); e.target.value = ''; e.target.blur(); } else toast('No match in the library', true); }
  });
  // panel buttons
  $('bBrowse').onclick = () => openBrowse();
  $('bRandom').onclick = random;
  $('bCompare').onclick = () => setCompare(!S.compare);
  $('bGroups').onclick = () => setGroups(!S.groups);
  $('bLewis').onclick = () => { openLewis(); if (PHONE_Q.matches) setOpen(false); };
  $('groupList').onclick = e => { const b = e.target.closest('.gl[data-g]'); if (!b) return; const id = b.dataset.g; setGroups(true, S.groups && S.groupFocus === id ? null : id); };
  document.querySelector('.exp').onclick = e => { const b = e.target.closest('button'); if (b) exportAs(b.dataset.x).catch(err => toast('Export failed: ' + err.message, true)); };
  $('bwClose').onclick = closeBrowse;
  // dock
  $('dockPanel').onclick = () => setOpen(!$('panel').classList.contains('open'));
  $('dockBrowse').onclick = () => browser.isOpen ? closeBrowse() : openBrowse();
  $('dockStyle').onclick = () => { const i = STYLES.findIndex(s => s[0] === S.style); setStyle(STYLES[(i + 1) % STYLES.length][0]); };
  $('dockGroups').onclick = () => setGroups(!S.groups);
  $('dockRandom').onclick = random;
  $('panelClose').onclick = () => setOpen(false);
  const grip = $('sheetGrip'); let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return; const dy = e.clientY - gy; gy = null; const p = $('panel');
    if (Math.abs(dy) < 8) p.classList.toggle('full'); else if (dy < -40) p.classList.add('full'); else if (dy > 40) { if (p.classList.contains('full')) p.classList.remove('full'); else setOpen(false); }
    setTimeout(occlusion, 320);
  });
  PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
  window.addEventListener('resize', occlusion);
  // keys
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === '/') { e.preventDefault(); if (PHONE_Q.matches) setOpen(true); $('q').focus(); }
    else if (e.key === 'r') random();
    else if (e.key === 'g') setGroups(!S.groups);
    else if (e.key === 'b') browser.isOpen ? closeBrowse() : openBrowse();
    else if (e.key === 'Escape') { if (browser.isOpen) closeBrowse(); else if (S.lewis) stopLewis(); }
    else if (e.key >= '1' && e.key <= '4') setStyle(STYLES[+e.key - 1][0]);
  });
  window.addEventListener('hashchange', () => { const r = fromHash(); if (r && r !== sides.a.rec) show('a', r, { noHash: true }); });
  window.addEventListener('pagehide', () => { running = false; for (const k in sides) { sides[k].view && sides[k].view.dispose(); } });
}
function fromHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!h) return null;
  return LIB.byId.get(h) || LIB.recs.find(x => 'cid-' + x.cid === h) || null;
}

async function boot() {
  sides.a = makeSide('a');
  wire();
  setOpen(!PHONE_Q.matches);
  loading('Loading the library');
  try { await loadLibrary(); } catch (e) { loading(null); toast('The library did not load: ' + e.message, true); return; }
  loading(null);
  browser = new Browser($('browse'), rec => { closeBrowse(); show('a', rec); });
  const start = fromHash() || LIB.byId.get('caffeine') || LIB.recs[0];
  show('a', start, { noHash: !location.hash });
  requestAnimationFrame(frame);
  occlusion();
  // the screensaver hook
  import('./saver.js').then(m => m.installSaver({ sides, show, LIB, S, setStyle, setGroups })).catch(e => console.warn('saver', e));
  // a hook for checks over CDP
  window.__mol = { S, sides, LIB, show: id => show('a', LIB.byId.get(id)), setCompare, setGroups, setStyle, openLewis, stopLewis, exportAs, runQuery, openBrowse, closeBrowse };
}
boot();
