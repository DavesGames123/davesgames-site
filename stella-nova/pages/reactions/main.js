// ============================================================================
//  REACTION EXPLORER  ·  main.js — state, panel, tree, step pane
// ----------------------------------------------------------------------------
//  Boot: data/species.json, then OpenChemLib (molecules/engine.js
//  loadEngine), then a named synthesis (or the one in the URL hash).
//  The tree (treeview.js) shows the synthesis; pointing at a molecule (a
//  tap on touch) shows the step that made it: the 2D scheme, the equation
//  in TeX, and the 3D change in the ONE shared RxView (rxview.js).
//  Hash: #s=<named id>, #c=<class id>, #b=<builder ops> (buildui.js).
//  The right-hand surface (buildui.js) builds a tree of the user's own;
//  each change shows that tree here.
//
//  grep -n targets
//    boot ............ "async function boot"
//    a synthesis ..... "function showSynth"
//    a molecule ...... "function showNode"
//    a step .......... "function showStep"
//    growth .......... "function grow("
//    phone sheet ..... "function setOpen" "function occlusion"
//    frame loop ...... "function frame"
//    screensaver ..... saver.js installSaver (window.snSaver)
// ============================================================================
import { RxView } from './rxview.js';
import { TreeView } from './treeview.js';
import { makeScene } from './rxanim.js';
import { emptySynth, addStep, fromNamed, layout, growOrder, fromRoute } from './synth.js';
import { NAMED, CLASSES, CLASS, FAMILIES, BASICS, SPECIES } from './templates.js';
import { speciesSearch } from './builder.js';
import { blockedWhy } from './react.js';
import { nodeOfGraph } from './steps.js';
import { fromOCL } from './rxgraph.js';
import { search as libSearch } from '../molecules/browse.js';
import { useData, speciesByKey, ceOf } from './species.js';
import { setOCL } from './react.js';
import { fromRecord, keyOf, hill } from './rxgraph.js';
import { nodeOfSpecies } from './steps.js';
import { Builder } from './builder.js';
import { BuilderUI } from './buildui.js';
import { loadEngine, fromSmiles } from '../molecules/engine.js';
import { LIB, loadLibrary } from '../molecules/browse.js';
import { decode } from '../molecules/chem.js';
import { render2D } from '../molecules/draw2d.js';
import { typeset } from '../../lib/sci-math.js';
import { installSaver } from './saver.js';
import { setRoute } from './route.js';

const $ = id => document.getElementById(id);
const PHONE_Q = window.matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const REDUCED_Q = window.matchMedia('(prefers-reduced-motion: reduce)');
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const LAYOUTS = [['clado', 'Tree'], ['radial', 'Radial'], ['fan', 'Fan']];

export const S = { synth: null, layout: 'clado', d3: false, eq: true, node: -1, OCL: null, view: null, tree: null, loop: false };
const scenes = new WeakMap(), arts = new Map(), stills = new Map();

// ── drawings ────────────────────────────────────────────────────────────────
function art(m) {
  const k = m.key + '|' + (m.rec.p2 || '');
  if (!arts.has(k)) { try { arts.set(k, render2D(decode(m.rec), { lw: 1.7, pad: 0.45, minW: 4.6, minH: 2.8 }).svg); } catch (e) { arts.set(k, ''); } }
  return arts.get(k);
}
function still(m) {
  if (!S.view) return '';
  if (!stills.has(m.key)) { S.view.still(m.rec); stills.set(m.key, S.view.snapshot(300, 180)); }
  return stills.get(m.key);
}

// ── a synthesis ─────────────────────────────────────────────────────────────
function showSynth(syn, opts = {}) {
  S.synth = syn; S.node = -1;
  if (syn.root < 0) {
    S.tree.inner.innerHTML = ''; S.tree.lay = null;
    $('treeTitle').innerHTML = '<b>Your synthesis</b> · empty';
    return;
  }
  $('treeTitle').innerHTML = `<b>${esc(syn.name || 'Synthesis')}</b>`;
  relayout();
  document.querySelectorAll('#namedList button').forEach(b => b.classList.toggle('on', b.dataset.n === syn.named));
  document.querySelectorAll('.cls').forEach(b => b.classList.toggle('on', b.dataset.c === syn.cls));
  if (!opts.noHash) setRoute(syn.named ? 's=' + syn.named : syn.cls ? 'c=' + syn.cls : '');
  showNode(syn.root);
  if (opts.grow !== false && !REDUCED_Q.matches) grow();
}
function relayout() {
  const syn = S.synth; if (!syn) return;
  const keep = S.view ? S.view.S : null, t = S.view ? S.view.t : 0, playing = S.view && S.view.playing;
  const lay = layout(syn, S.layout, PHONE_Q.matches ? 130 : 150);
  S.tree.set(syn, lay, { d3: S.d3, eq: S.eq, art, still });
  if (S.view && keep && S.d3) { S.view.setScene(keep); S.view.t = t; S.view.playing = playing; }
  if (S.node >= 0) S.tree.light(S.node);
}
// the growth playback: the camera follows the newest molecule unless the
// user moves the tree
function grow(perNode = 0.9) {
  const syn = S.synth, n = growOrder(syn).length, T = n * perNode * 1000, t0 = performance.now(), tok = S.growTok = (S.growTok || 0) + 1;
  S.tree.user = false;
  let last = -1;
  const step = now => {
    if (S.growTok !== tok || S.synth !== syn) return;
    const u = Math.min(1, (now - t0) / T);
    S.tree.grow(u);
    const g = S.tree.growing();
    if (g !== last && g >= 0) { last = g; if (!S.tree.user) S.tree.focus(g, Math.max(0.55, Math.min(1, S.tree.view.s)), 500); if (syn.nodes[g].step >= 0) showNode(g); }
    if (u < 1) requestAnimationFrame(step); else if (!S.tree.user) setTimeout(() => S.synth === syn && !S.tree.user && S.tree.fit(true), 600);
  };
  requestAnimationFrame(step);
}

// ── a molecule ──────────────────────────────────────────────────────────────
function showNode(id) {
  const syn = S.synth; if (!syn || id === S.node) return;
  S.node = id; S.tree.light(id);
  const n = syn.nodes[id];
  if (n.step >= 0) { showStep(syn.steps[n.step]); return; }
  // a starting compound: its still, turning
  $('stepTitle').innerHTML = `<b>${esc(n.mol.name)}</b> · starting compound`;
  $('scheme').innerHTML = `<div class="sc-row">${molCard(n.mol)}</div><p class="sc-note">A starting compound of this synthesis${n.coef > 1 ? `, used ${n.coef} times` : ''}. Point at a product to see the step that made it.</p>`;
  if (S.view) { S.view.still(n.mol.rec); S.view.play(0); }
  $('info').innerHTML = `<div class="i-name">${esc(n.mol.name)}</div><p>${esc(n.mol.rec.d || 'A starting compound.')}</p>`;
}
function molCard(m, by = false, n = 1) {
  return `<div class="sc-mol${by ? ' by' : ''}"><div class="th">${art(m)}</div><small>${n > 1 ? n + ' ' : ''}${esc(m.name)}</small></div>`;
}

// ── a step ──────────────────────────────────────────────────────────────────
function showStep(s) {
  const st = s.st, cls = CLASS[st.cls];
  $('stepTitle').innerHTML = `<b>${esc(cls.name)}</b> · makes ${esc(st.products[st.made].name)}`;
  const left = st.left.filter(t => !/^\[|\]$/.test(t.ce)).map(t => molCard(t.node, false, t.n)).join('<span class="sc-op">+</span>');
  const formal = st.left.filter(t => /^\[/.test(t.ce)).map(t => (t.n > 1 ? t.n : '') + t.ce).join(' ');
  const right = st.right.map((t, i) => molCard(t.node, t.key !== st.products[st.made].key, t.n)).join('<span class="sc-op">+</span>');
  const by = st.products.filter((p, i) => i !== st.made).map(p => p.name);
  $('scheme').innerHTML = `<div class="sc-row">${left}<div class="sc-arrow"><span>${esc([cls.cond, formal].filter(Boolean).join(' · ').replace(/\$[^$]*\$/g, ''))}</span><i>${cls.arrow === '<=>' ? '⇌' : '⟶'}</i><span>${esc((cls.below || '').replace(/\$[^$]*\$/g, m => m.includes('Delta') ? 'heat' : m.replace(/[$\\{}]|mathrm|circ|,/g, '').replace('^', '°')))}</span></div>${right}</div>`
    + `<div class="sc-tex"></div><p class="sc-note">${esc(cls.d)}</p>`;
  typeset($('scheme').querySelector('.sc-tex'), st.tex);
  $('info').innerHTML = `<div class="i-name">${esc(cls.name)}</div><div class="i-tex"></div><p>${esc(cls.d)}</p>`
    + `<div class="i-by">${by.length ? `By-products: <b>${by.map(esc).join(', ')}</b>` : 'No by-product'} · ${esc(FAMILIES.find(f => f[0] === cls.family)[1])}</div>`;
  typeset($('info').querySelector('.i-tex'), `\\ce{${cls.tex}}`);
  if (S.view) {
    let sc = scenes.get(st);
    if (!sc) { sc = makeScene(st); scenes.set(st, sc); }
    S.view.setScene(sc); S.view.loop = S.loop; S.view.play(0);
  }
}

// ── panel lists ─────────────────────────────────────────────────────────────
function buildLists() {
  $('basicList').innerHTML = BASICS.filter(([k]) => k !== 'oform').map(([k]) => `<span>${esc(SPECIES[k][1])}</span><span>${esc(SPECIES[k][2])}</span>`).join('');
  $('namedList').innerHTML = NAMED.map(n => `<button type="button" data-n="${n.id}">${esc(n.name)}<small>${n.steps.length} step${n.steps.length > 1 ? 's' : ''}</small></button>`).join('');
  $('classList').innerHTML = FAMILIES.map(([f, name]) => `<div class="fam">${esc(name)}</div>` + CLASSES.filter(c => c.family === f).map(c => `<button type="button" class="cls" data-c="${c.id}">${esc(c.name)}</button>`).join('')).join('');
}
function loadNamed(id, opts) {
  const N = NAMED.find(n => n.id === id); if (!N) return;
  loading('Building ' + N.name);
  setTimeout(() => {
    try { showSynth(fromNamed(S.OCL, N), opts); } catch (e) { console.error(e); toast('This synthesis could not be built: ' + e.message, true); }
    loading(null);
  }, 30);
}
export function classSynth(cid) {
  const cls = CLASS[cid], syn = emptySynth();
  const ins = cls.kind === 'overall' ? (cls.fuel ? cls.ex.slice(0, 1) : cls.lhsQ.map(x => x[0])) : cls.ex.slice(0, cls.lhs.length);
  if (addStep(syn, S.OCL, cls, ins) < 0) throw new Error('the example did not react');
  syn.name = cls.name; syn.cls = cid;
  return syn;
}
function loadClass(cid, opts) {
  loading('Building the example');
  setTimeout(() => {
    try { showSynth(classSynth(cid), opts); } catch (e) { console.error(e); toast(e.message, true); }
    loading(null);
  }, 30);
}

// ── UI helpers ─────────────────────────────────────────────────────────────
let toastT = 0;
export function toast(msg, err) { const t = $('toast'); t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200); }
export function loading(msg) { $('loading').hidden = !msg; if (msg) $('loadingText').textContent = msg; }
function setLayout(k) {
  S.layout = k;
  document.querySelectorAll('#laySeg button').forEach(b => b.classList.toggle('on', b.dataset.l === k));
  $('dockLayoutV').textContent = LAYOUTS.find(l => l[0] === k)[1];
  relayout(); S.tree.fit(true);
}
function setOpen(open) {
  if (open && PHONE_Q.matches) setBuild(false, true);
  $('panel').classList.toggle('open', open);
  $('dockPanel').classList.toggle('on', open);
  $('dockPanel').setAttribute('aria-expanded', String(open));
  occlusion();
}
function setBuild(open, quiet) {
  if (!PHONE_Q.matches) open = true;
  if (open && PHONE_Q.matches && !quiet) setOpen(false);
  $('build').classList.toggle('open', open);
  $('dockBuild').classList.toggle('on', open && PHONE_Q.matches);
  $('dockBuild').setAttribute('aria-expanded', String(open));
  if (!quiet) occlusion();
}
// The stage ends where the sheet begins (portrait) or the drawer begins
// (landscape), so the tree and the 3D view stay in sight.
export function occlusion() {
  const root = document.documentElement.style;
  if (!PHONE_Q.matches) { root.setProperty('--occ-b', '0px'); root.setProperty('--occ-r', '0px'); return; }
  const sheet = $('panel').classList.contains('open') ? $('panel') : $('build').classList.contains('open') ? $('build') : null;
  const open = !!sheet;
  const dock = $('dock').getBoundingClientRect().height;
  const land = window.matchMedia('(max-height:500px) and (orientation:landscape) and (pointer:coarse)').matches;
  if (land) { root.setProperty('--occ-b', dock + 'px'); root.setProperty('--occ-r', open ? sheet.getBoundingClientRect().width + 'px' : '0px'); return; }
  root.setProperty('--occ-r', '0px');
  root.setProperty('--occ-b', (dock + (open ? sheet.offsetHeight : 0)) + 'px');
}

// ── frame loop ─────────────────────────────────────────────────────────────
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (S.view && !document.hidden) S.view.frame(dt);
}

function wire() {
  $('namedList').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { loadNamed(b.dataset.n); if (PHONE_Q.matches) setOpen(false); } });
  $('classList').addEventListener('click', e => { const b = e.target.closest('.cls'); if (b) { loadClass(b.dataset.c); if (PHONE_Q.matches) setOpen(false); } });
  $('laySeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setLayout(b.dataset.l); });
  $('dockLayout').addEventListener('click', () => { const i = LAYOUTS.findIndex(l => l[0] === S.layout); setLayout(LAYOUTS[(i + 1) % LAYOUTS.length][0]); });
  $('b3d').addEventListener('click', () => { S.d3 = !S.d3; $('b3d').classList.toggle('on', S.d3); relayout(); });
  $('bEq').addEventListener('click', () => { S.eq = !S.eq; $('bEq').classList.toggle('on', S.eq); relayout(); });
  $('bGrow').addEventListener('click', () => grow());
  $('rGo').addEventListener('click', () => findRoute());
  $('rq').addEventListener('keydown', e => { if (e.key === 'Enter') findRoute(); });
  $('dockGrow').addEventListener('click', () => grow());
  $('bFit').addEventListener('click', () => { S.tree.user = false; S.tree.fit(true); });
  const replay = () => { if (S.view) { S.view.userCam = false; S.view.play(0); } };
  $('bReplay').addEventListener('click', replay); $('dockReplay').addEventListener('click', replay);
  $('bLoop').addEventListener('click', () => { S.loop = !S.loop; $('bLoop').classList.toggle('on', S.loop); if (S.view) { S.view.loop = S.loop; if (S.loop && !S.view.playing) S.view.play(0); } });
  $('dockPanel').addEventListener('click', () => setOpen(!$('panel').classList.contains('open')));
  $('dockBuild').addEventListener('click', () => setBuild(!$('build').classList.contains('open')));
  $('buildClose').addEventListener('click', () => setBuild(false));
  $('panelClose').addEventListener('click', () => setOpen(false));
  // the sheet grip: a drag down closes the sheet
  let gy = null;
  $('sheetGrip').addEventListener('pointerdown', e => { gy = e.clientY; $('sheetGrip').setPointerCapture(e.pointerId); });
  $('sheetGrip').addEventListener('pointerup', e => { if (gy != null && e.clientY - gy > 40) setOpen(false); gy = null; });
  PHONE_Q.addEventListener('change', () => { setOpen(!PHONE_Q.matches); setBuild(!PHONE_Q.matches, true); occlusion(); });
  addEventListener('resize', occlusion);
  addEventListener('hashchange', fromHash);
  addEventListener('keydown', e => {
    if (e.target.closest('input,textarea')) return;
    if (e.key === 'g') grow(); else if (e.key === 'r') replay(); else if (e.key === 'f') { S.tree.user = false; S.tree.fit(true); }
  });
}
function fromHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith('s=') && NAMED.some(n => n.id === h.slice(2))) { loadNamed(h.slice(2), { noHash: true }); return true; }
  if (h.startsWith('c=') && CLASS[h.slice(2)]) { loadClass(h.slice(2), { noHash: true }); return true; }
  if (h.startsWith('b=') && S.ui) { loadBuild(h.slice(2)); return true; }
  return false;
}

// ── find a route ────────────────────────────────────────────────────────────
// The search runs in a Web Worker (retro-worker.js, retro.js). The target
// is a species name, a Molecule Explorer library name, or SMILES.
let worker = null, wid = 0;
async function resolveTarget(text) {
  const t = text.trim(); if (!t) return null;
  const sp = speciesSearch(t, 1)[0];
  if (sp && SPECIES[sp][1].toLowerCase() === t.toLowerCase()) return { sp, name: SPECIES[sp][1] };
  if (!/[=#()[\]@\\/]/.test(t) || /\s/.test(t)) {
    try { await loadLibrary(); } catch (e) { /* offline */ }
    const r = libSearch(t, 1)[0];
    if (r && r.s) return { smiles: r.s, name: r.n };
    if (sp) return { sp, name: SPECIES[sp][1] };
  }
  try { const m = S.OCL.Molecule.fromSmiles(t); if (m.getAllAtoms()) return { smiles: t, name: t }; } catch (e) { /* not SMILES */ }
  return null;
}
async function findRoute() {
  const st = $('rStatus'), list = $('rList');
  st.classList.remove('err'); list.innerHTML = '';
  const tg = await resolveTarget($('rq').value);
  if (!tg) { st.textContent = 'Not a name in the library and not a SMILES string the engine can read.'; st.classList.add('err'); return; }
  const G = tg.sp ? null : fromOCL(S.OCL, S.OCL.Molecule.fromSmiles(tg.smiles));
  const why = G ? blockedWhy(G) : null;
  if (why) { st.textContent = `This page does not plan routes to ${why}. Try an everyday compound such as aspirin, ethyl acetate or paracetamol.`; st.classList.add('err'); return; }
  const maxSteps = +$('rSteps').value;
  st.innerHTML = `<span class="spin" style="display:inline-block;vertical-align:-3px"></span> Searching backward from ${esc(tg.name)}, at most ${maxSteps} steps`;
  if (!worker) worker = new Worker(new URL('retro-worker.js', import.meta.url), { type: 'module' });
  const id = ++wid;
  const res = await new Promise(resolve => {
    worker.onmessage = e => { if (e.data.id === id) resolve(e.data); };
    worker.onerror = e => resolve({ id, error: e.message || 'the worker failed' });
    worker.postMessage({ id, sp: tg.sp, smiles: tg.smiles, maxSteps });
  });
  if (id !== wid) return;
  if (res.error) { st.textContent = 'The search failed: ' + res.error; st.classList.add('err'); return; }
  const r = res.result, secs = (r.stats.ms / 1000).toFixed(1);
  if (!r.routes.length) {
    st.classList.add('err');
    st.textContent = r.reason === 'basic' ? `${tg.name} is already one of the starting compounds.`
      : /^blocked/.test(r.reason) ? `This page does not plan routes to ${r.reason.slice(9)}.`
      : r.reason === 'limit' ? `The search stopped at its limit (${r.stats.expanded} backward steps, ${secs} s) with no route. This teaching model knows only ${CLASSES.length} reaction classes.`
      : `No route within ${maxSteps} steps from the starting compounds with these ${CLASSES.length} reaction classes. A real synthesis may well exist; this model does not know it.`;
    return;
  }
  st.textContent = `${r.routes.length} route${r.routes.length > 1 ? 's' : ''} in ${secs} s (${r.stats.expanded} backward steps). The best is in the tree.`;
  const label = sp => (SPECIES[sp] ? SPECIES[sp][1] : sp);
  list.innerHTML = r.routes.map((ro, i) => `<button type="button" data-i="${i}">Route ${i + 1}: ${ro.steps.length} step${ro.steps.length > 1 ? 's' : ''}<small>${esc(ro.steps.map(s => CLASS[s.cls].name).join(' → '))}<br>from ${esc([...new Set(ro.leaves)].map(label).join(', '))}</small></button>`).join('');
  const show = i => {
    try {
      const syn = fromRoute(S.OCL, r.routes[i], smi => nodeOfGraph(S.OCL, fromOCL(S.OCL, S.OCL.Molecule.fromSmiles(smi))));
      syn.name = `Route to ${tg.name}`;
      showSynth(syn, { noHash: true });
      list.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.i === i));
    } catch (e) { console.error(e); toast('This route could not be rebuilt: ' + e.message, true); }
  };
  list.onclick = e => { const b = e.target.closest('button'); if (b) { show(+b.dataset.i); if (PHONE_Q.matches) setOpen(false); } };
  show(0);
}

// ── build your own ─────────────────────────────────────────────────────────
function nodeOfRecord(rec, name) {
  const G = fromRecord(rec), key = keyOf(S.OCL, G), sp = speciesByKey(key);
  return { rec, G, key, name: name || rec.n, ce: sp ? ceOf(sp) : hill(G).replace(/[+-]\d*$/, ''), sp };
}
async function nodeOfSmiles(smi) {
  const rec = await fromSmiles(smi);
  const n = nodeOfRecord(rec);
  if (n.sp) return nodeOfSpecies(n.sp);
  return n;
}
// a share link: fetch what its molecules need, then replay the ops
async function loadBuild(code) {
  loading('Rebuilding the shared tree');
  try {
    const ops = JSON.parse(decodeURIComponent(escape(atob(code.replace(/-/g, '+').replace(/_/g, '/')))));
    const pre = new Map();
    if (ops.some(o => o[0] === 'a' && String(o[1]).startsWith('lib:'))) await loadLibrary();
    for (const o of ops) {
      if (o[0] !== 'a') continue;
      const k = String(o[1]);
      if (k.startsWith('lib:')) { const r = LIB.byId.get(k.slice(4)); if (r) pre.set(k, nodeOfRecord(r)); }
      else if (k.startsWith('smi:')) pre.set(k, await nodeOfSmiles(k.slice(4)));
    }
    const b = Builder.decode(S.OCL, code, k => pre.get(k) || (k.startsWith('lib:') || k.startsWith('smi:') ? null : nodeOfSpecies(k)));
    S.ui.load(b);
    if (PHONE_Q.matches) setBuild(true);
  } catch (e) { console.error(e); toast('The shared link could not be read.', true); }
  loading(null);
}

async function boot() {
  wire(); buildLists();
  if (PHONE_Q.matches) setOpen(false); else setOpen(true);
  setBuild(!PHONE_Q.matches, true);
  S.tree = new TreeView($('tree'), { hover: id => showNode(id), pick: id => { S.node = -1; showNode(id); } });
  try { S.view = new RxView(document.querySelector('#stepPane canvas'), { labels: document.querySelector('#stepPane .labels3'), lite: PHONE_Q.matches }); }
  catch (e) { S.view = null; $('nogl').hidden = false; }
  requestAnimationFrame(frame);
  loading('Loading the reaction library');
  let OCL = null;
  try {
    let data;
    [data, OCL] = await Promise.all([fetch(new URL('data/species.json', import.meta.url)).then(r => { if (!r.ok) throw new Error('species ' + r.status); return r.json(); }), loadEngine()]);
    useData(data); setOCL(OCL); S.OCL = OCL;
  } catch (e) { loading(null); toast('The reaction library did not load: ' + e.message, true); return; }
  loading(null);
  S.ui = new BuilderUI($('build'), {
    OCL, toast, busy: loading, nodeOfSmiles,
    nodeOfLib: rec => nodeOfRecord(rec),
    focus: id => { if (S.synth === S.ui.b.S) showNode(id); },
    onChange: (syn, id, quiet) => {
      showSynth(syn, { grow: false, noHash: true });
      if (id >= 0) { S.node = -1; showNode(id); }
      if (!quiet) setRoute(syn.nodes.length ? 'b=' + S.ui.b.encode() : '');
    },
  });
  if (!fromHash()) loadNamed('aspirin', { noHash: true });
  window.__rx = { S, showSynth, loadNamed, loadClass };
  installSaver({ S, showSynth, art });
}
boot();
