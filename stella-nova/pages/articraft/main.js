// ============================================================================
//  ARTICRAFT PLAYGROUND  ·  main.js — the page: gallery, panel, dock, view
// ----------------------------------------------------------------------------
//  sim.js holds the physics side (no DOM). This file reads the manifest,
//  loads the object of ?o=<slug> (only that object), mounts the MuJoCo Lab
//  renderer (../mujoco-lab/render/README.md is its API) and runs the loop.
//
//  CONTROLS
//    sliders           one position actuator target for each joint
//    1-9               select joint 1..9;  arrows move it (Shift: fine)
//    A animate  R random pose  L Anchored/Loose  D drop  P props
//    0 reset  Space pause  G objects  Esc close the object list
//    pointer           drag a part: mouse spring (S.perturb, the renderer
//                      pointer code); drag empty space: orbit; wheel: zoom
//
//  PHONE  (the wave-membrane pattern, commit 71bfb1a)
//    #dock at the base with the primary controls. Portrait: #panel is a
//    bottom sheet; #sheetGrip tap = half/full, drag down = close. Landscape:
//    #panel is a drawer on the right. occlusion() measures the panel, the
//    dock and the topbar each frame. The camera view offset then moves the
//    object into the clear part, so the sheet never covers it.
//
//  window.__articraft  (for tests and the console)
//    select(slug) setLoose(b) setProps(b) drop() animate(b) random() reset()
//    manifest, entry, sim, view
//
//  GREP MAP
//    async function boot ......... MuJoCo + manifest, first object
//    async function loadSim ...... every (re)load goes through here
//    async function mountView .... renderer.js into #stage
//    function fitCamera .......... camera distance for the clear part
//    function occlusion .......... overlay margins (wave-membrane pattern)
//    function frame .............. the loop
//    function buildJoints / refreshJoints
//    function buildGallery / buildCredits
//    function onKey .............. keyboard
//    function setOpen ............ the panel, the sheet and the dock button
//    function release ............ pagehide: free WASM objects and GL
// ============================================================================
import { loadMuJoCo } from '../mujoco-lab/core/engine.js';
import { createMjRenderer } from '../mujoco-lab/render/renderer.js';
import { loadManifest, loadObject, setTargets, poseAt, randomPose, restPose, drop, jointRange, DEFAULT_PROPS, PAPER } from './sim.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const LOOP_S = 8;          // seconds for one Animate loop
const el = (tag, attrs = {}, kids = []) => {
  const e = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else if (k === 'on') for (const t in v) e.addEventListener(t, v[t]);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(kids)) if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
};

// ---- state ----------------------------------------------------------------------
let mj = null, man = null, entry = null, S = null, view = null, THREE = null, canvas = null;
let loose = false, propsOn = false, animating = false, playing = true, phase = 0, selJoint = 0;
let raf = 0, lastT = 0, frameNo = 0, released = false, loadToken = 0, jointRows = [];
const occ = { l: 0, r: 0, t: 0, b: 0 };

function status(msg, err = false) {
  $('boot').hidden = !msg;
  $('boot').textContent = msg || '';
  $('boot').classList.toggle('err', !!err);
}
const fmtJ = (j, v) => (!isFinite(v) ? '–' : j.type === 'slide' ? `${(v * 1000).toFixed(0)} mm` : `${(v * 180 / Math.PI).toFixed(0)}°`);
const driven = () => (entry ? (entry.joints || []).filter(j => j.type !== 'ball' && j.act !== null) : []);

// ---- boot ---------------------------------------------------------------------------
async function boot() {
  status('Loading MuJoCo…');
  try {
    [mj, man] = await Promise.all([loadMuJoCo(), loadManifest()]);
  } catch (e) { console.error(e); status('MuJoCo or the object list could not load: ' + (e && e.message || e), true); return; }
  if (man.base !== 'data/') $('gallerySub').textContent = 'Test objects. The Articraft records are not on this server yet.';
  const want = new URLSearchParams(location.search).get('o');
  entry = man.objects.find(o => o.slug === want) || man.objects[0];
  buildGallery();
  await loadSim(null);
  raf = requestAnimationFrame(frame);
}

async function loadSim(keep, { keepCamera = false } = {}) {
  const token = ++loadToken, e = entry;
  status(`Loading ${e.title}…`);
  let S2;
  try {
    S2 = await loadObject(mj, e, { loose, props: propsOn ? DEFAULT_PROPS : [] });
  } catch (err) {
    console.error(err);
    if (token === loadToken) status(`${e.title} could not load: ${err && err.message || err}`, true);
    return;
  }
  if (token !== loadToken || released) { S2.dispose(); return; }
  if (keep) setTargets(S2, keep);
  const cam = keepCamera && view ? view.getCamera() : null;
  const old = S; S = S2;
  if (view) view.setSim(S); else await mountView();
  if (old) old.dispose();
  if (view) { if (cam) view.setCamera({ ...cam, mode: 'free' }); else fitCamera(); }
  syncButtons(); buildJoints(); buildCredits();
  $('objTitle').textContent = e.title;
  $('objName').textContent = e.title;
  $('objMeta').textContent = `${e.category || ''} · ${driven().length} joint${driven().length === 1 ? '' : 's'}`;
  document.title = `${e.title} · Articraft Playground — Stella Nova · davesgames.io`;
  status(view && view.gl ? '' : 'The 3D view could not start (WebGL).', !(view && view.gl));
}

async function mountView() {
  if (view || released) return view;
  try {
    THREE = THREE || globalThis.THREE || await import('three');
    canvas = canvas || el('canvas', { id: 'view', 'aria-hidden': 'true' });
    if (!canvas.parentNode) $('stage').appendChild(canvas);
    view = createMjRenderer(canvas, S, { THREE, phone: PHONE_Q.matches, theme: 'night', flags: { perturb: true } });
    view.resize();
    return view;
  } catch (e) { console.error(e); view = null; return null; }
}

// ---- framing -------------------------------------------------------------------------
// Overlay margins in CSS px (wave-membrane rule): an overlay that is wider
// than tall covers the top or the base, else a side. It counts only when it
// spans half of that edge or more.
const OVERLAYS = () => [$('panel'), $('dock'), document.querySelector('.topbar')].filter(Boolean);
function occlusion(w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  for (const e of OVERLAYS()) {
    const q = e.getBoundingClientRect();
    const x0 = Math.max(0, q.left), x1 = Math.min(w, q.right), y0 = Math.max(0, q.top), y1 = Math.min(h, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) { if (fw < 0.5) continue; if (y0 + y1 > h) o.b = Math.max(o.b, h - y0); else o.t = Math.max(o.t, y1); }
    else { if (fh < 0.5) continue; if (x0 + x1 < w) o.l = Math.max(o.l, x1); else o.r = Math.max(o.r, w - x0); }
  }
  return o;
}
function frameView(snap = false) {
  if (!view || !view.camera || !view.camera.setViewOffset) return;
  const w = innerWidth, h = innerHeight, o = occlusion(w, h);
  for (const k in occ) occ[k] = snap ? o[k] : occ[k] + (o[k] - occ[k]) * 0.18;
  view.camera.setViewOffset(w, h, (occ.r - occ.l) / 2, (occ.b - occ.t) / 2, w, h);
  view.camera.updateProjectionMatrix();
}
// distance so the bounding sphere fits in the clear part of the window
// keep = true: keep the orbit angles and the look-at point (sheet toggles)
function fitCamera(keep = false) {
  if (!view || !S) return;
  const w = innerWidth, h = innerHeight, o = occlusion(w, h);
  const cw = Math.max(80, w - o.l - o.r), ch = Math.max(80, h - o.t - o.b);
  const c = S.entry.camera, e = Math.max(0.05, entry.extent || 0.3), tf = Math.tan(22.5 * Math.PI / 180);
  const d = Math.max(c.distance, 1.2 * e / tf * Math.max(h / ch, h / cw));
  const k = keep ? view.getCamera() : c;
  view.setCamera({ mode: 'free', azimuth: k.azimuth, elevation: k.elevation, lookat: k.lookat, distance: d });
  frameView(true);
}

// ---- loop -------------------------------------------------------------------------------
function frame(t) {
  raf = requestAnimationFrame(frame);
  if (!S || !view || released || window.snSaverActive) { lastT = t; return; }
  const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 1 / 60;
  lastT = t;
  if (playing) {
    if (animating) { phase = (phase + dt / LOOP_S) % 1; setTargets(S, poseAt(entry, phase)); }
    S.advance(dt);
  }
  frameView();
  view.render();
  if (++frameNo % 6 === 0) refreshJoints();
}

// ---- joints -------------------------------------------------------------------------------
function buildJoints() {
  const box = $('joints'); box.textContent = ''; jointRows = [];
  const js = driven();
  if (!js.length) { box.appendChild(el('p', { class: 'none', text: 'This object has no driven joints.' })); return; }
  selJoint = Math.min(selJoint, js.length - 1);
  js.forEach((j, i) => {
    const [lo, hi] = jointRange(j);
    const inp = el('input', { type: 'range', min: lo, max: hi, step: (hi - lo) / 400, value: S.targets[j.name] ?? 0, 'aria-label': `${j.name} target` });
    const val = el('span', { class: 'val' });
    const row = el('div', { class: 'joint' + (i === selJoint ? ' sel' : '') }, [
      el('span', { class: 'k', text: i < 9 ? String(i + 1) : '' }), el('span', { class: 'nm', text: j.name, title: `${j.name} (${j.type})` }), val, inp]);
    let dragging = false;
    inp.addEventListener('pointerdown', () => { dragging = true; });
    inp.addEventListener('pointerup', () => { dragging = false; });
    inp.addEventListener('input', () => { setAnim(false); setTargets(S, { [j.name]: +inp.value }); selectJoint(i); });
    inp.addEventListener('change', () => { dragging = false; });
    box.appendChild(row);
    jointRows.push({ j, row, inp, val, get dragging() { return dragging; } });
  });
  refreshJoints();
}
function refreshJoints() {
  if (!S) return;
  for (const r of jointRows) {
    if (!r.dragging && document.activeElement !== r.inp && S.targets[r.j.name] != null) r.inp.value = S.targets[r.j.name];
    r.val.textContent = fmtJ(r.j, S.jointValue(r.j.name));
  }
}
function selectJoint(i) {
  selJoint = i;
  jointRows.forEach((r, k) => r.row.classList.toggle('sel', k === i));
}
function nudge(sign, fine) {
  const r = jointRows[selJoint]; if (!r) return;
  const [lo, hi] = jointRange(r.j), cur = S.targets[r.j.name] ?? 0;
  setAnim(false);
  setTargets(S, { [r.j.name]: cur + sign * (hi - lo) * (fine ? 0.01 : 0.04) });
  refreshJoints();
}

// ---- actions ---------------------------------------------------------------------------
function setAnim(on) {
  animating = !!on;
  if (on) phase = 0;
  for (const id of ['btnAnim', 'dockAnim']) $(id).setAttribute('aria-pressed', String(animating));
}
function setLoose(on) {
  if (!!on === loose || !S) return Promise.resolve();
  loose = !!on; syncButtons();
  return loadSim({ ...S.targets }, { keepCamera: true });
}
function setProps(on) {
  if (!!on === propsOn || !S) return Promise.resolve();
  propsOn = !!on; syncButtons();
  return loadSim({ ...S.targets }, { keepCamera: true });
}
function doDrop() { if (S && loose) { drop(S); playing || setPlaying(true); } }
function doRandom() { if (!S) return; setAnim(false); setTargets(S, randomPose(entry)); refreshJoints(); }
function doReset() { if (!S) return; setAnim(false); S.reset(); setTargets(S, restPose(entry)); refreshJoints(); }
function setPlaying(on) { playing = !!on; $('btnPlay').setAttribute('aria-pressed', String(playing)); $('btnPlay').textContent = playing ? 'Pause' : 'Play'; }
function syncButtons() {
  for (const seg of [$('modeSeg'), $('dockMode')]) for (const b of seg.querySelectorAll('button')) {
    const on = (b.dataset.mode === 'loose') === loose;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
  }
  $('btnDrop').disabled = !loose; $('dockDrop').disabled = !loose;
  $('btnProps').setAttribute('aria-pressed', String(propsOn));
}
async function choose(slug) {
  closeGallery();
  const e = man && man.objects.find(o => o.slug === slug);
  if (!e || (entry && e.slug === entry.slug && S)) return;
  entry = e; setAnim(false); selJoint = 0;
  try { history.replaceState(null, '', '?o=' + encodeURIComponent(slug)); } catch (x) { /* sandboxed frame */ }
  for (const c of document.querySelectorAll('.gcard')) c.classList.toggle('cur', c.dataset.slug === slug);
  await loadSim(null);
}

// ---- gallery and credits ----------------------------------------------------------------
function buildGallery() {
  const list = $('galleryList'); list.textContent = '';
  const groups = (man.groups || []).slice();
  for (const o of man.objects) if (!groups.find(g => g.id === o.group)) groups.push({ id: o.group, title: o.group });
  for (const g of groups) {
    const objs = man.objects.filter(o => o.group === g.id);
    if (!objs.length) continue;
    const cards = el('div', { class: 'gcards' });
    for (const o of objs) {
      const n = (o.joints || []).filter(j => j.type !== 'ball' && j.act !== null).length;
      cards.appendChild(el('button', { type: 'button', class: 'gcard' + (entry && o.slug === entry.slug ? ' cur' : ''), 'data-slug': o.slug, on: { click: () => choose(o.slug) } },
        [el('b', { text: o.title }), el('span', { text: `${n} joint${n === 1 ? '' : 's'}` })]));
    }
    list.appendChild(el('section', { class: 'gsec' }, [el('h3', { text: `${g.title} (${objs.length})` }), cards]));
  }
}
function openGallery() {
  $('gallery').hidden = false;
  const cur = document.querySelector('.gcard.cur') || document.querySelector('.gcard');
  if (cur) { cur.focus(); cur.scrollIntoView({ block: 'center' }); }
}
function closeGallery() { $('gallery').hidden = true; }

function buildCredits() {
  const c = $('credits'), e = entry; c.textContent = '';
  const link = (href, text) => el('a', { href, target: '_blank', rel: 'noopener', text });
  const row = (k, v) => [el('dt', { text: k }), el('dd', {}, v)];
  c.appendChild(el('dl', {}, [
    ...row('Object', e.title), ...row('Category', e.category || '–'),
    ...row('Record', e.url ? link(e.url, e.record) : e.record), ...row('Revision', e.revision || '–'),
    ...row('Author', e.author || '–'),
    ...row('Licence', ['Articraft dataset, ', link('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0')]),
    ...row('Paper', [link(PAPER.arxiv, `${PAPER.authors}, arXiv:2605.15187`), ' · ', link(PAPER.site, 'project page')]),
  ]));
  if (e.prompt) c.appendChild(el('details', {}, [el('summary', { text: 'Prompt of the record' }), el('blockquote', { text: e.prompt })]));
  if (e.record === 'fixture') c.appendChild(el('p', { class: 'note', text: 'This is a test object of this page, not a dataset record.' }));
  c.appendChild(el('p', { class: 'note' }, ['Physics: ', link('https://github.com/google-deepmind/mujoco', 'MuJoCo 3.15.0'), ' (Google DeepMind, Apache-2.0). We changed the geometry: meshes are simplified for the web.']));
}

// ---- panel, sheet, dock --------------------------------------------------------------------
function setOpen(open) {
  const p = $('panel');
  p.classList.toggle('open', open);
  if (!open) p.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  $('dockPanel').classList.toggle('on', open);
  $('dockPanel').setAttribute('aria-expanded', String(open));
  $('gear').setAttribute('aria-expanded', String(open));
  // phone: the sheet takes part of the height, so fit the distance again
  // after its slide (0.3 s)
  if (PHONE_Q.matches && view) setTimeout(() => fitCamera(true), 320);
}
function bindUI() {
  const toggle = () => setOpen(!$('panel').classList.contains('open'));
  $('gear').addEventListener('click', toggle);
  $('dockPanel').addEventListener('click', toggle);
  $('panelClose').addEventListener('click', () => setOpen(false));
  setOpen(!PHONE_Q.matches);
  PHONE_Q.addEventListener('change', e => { setOpen(!e.matches); setTimeout(fitCamera, 350); });

  // sheet grip: a tap switches half and full height; a drag up gives full
  // height; a drag down gives half height, then closes
  const grip = $('sheetGrip');
  let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ } });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return;
    const dy = e.clientY - gy, p = $('panel'); gy = null;
    if (Math.abs(dy) < 8) p.classList.toggle('full');
    else if (dy < -40) p.classList.add('full');
    else if (dy > 40) { if (p.classList.contains('full')) p.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gy = null; });

  for (const seg of [$('modeSeg'), $('dockMode')]) seg.addEventListener('click', e => { const b = e.target.closest('button'); if (b) setLoose(b.dataset.mode === 'loose'); });
  for (const id of ['btnAnim', 'dockAnim']) $(id).addEventListener('click', () => setAnim(!animating));
  for (const id of ['btnRandom', 'dockRandom']) $(id).addEventListener('click', doRandom);
  for (const id of ['btnDrop', 'dockDrop']) $(id).addEventListener('click', doDrop);
  for (const id of ['btnGallery', 'btnGallery2', 'dockGallery']) $(id).addEventListener('click', openGallery);
  $('btnReset').addEventListener('click', doReset);
  $('btnProps').addEventListener('click', () => setProps(!propsOn));
  $('btnPlay').addEventListener('click', () => setPlaying(!playing));
  $('galleryClose').addEventListener('click', closeGallery);
  $('gallery').addEventListener('click', e => { if (e.target === $('gallery')) closeGallery(); });
  addEventListener('keydown', onKey);
  addEventListener('resize', () => { if (view) { view.resize(); frameView(true); } });
  setTimeout(() => $('hint').classList.add('gone'), 12000);
}

function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (!$('gallery').hidden) { if (e.key === 'Escape') { closeGallery(); e.preventDefault(); } return; }
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const k = e.key;
  if (k >= '1' && k <= '9') { const i = +k - 1; if (i < jointRows.length) selectJoint(i); }
  else if (k === 'ArrowLeft' || k === 'ArrowDown') nudge(-1, e.shiftKey);
  else if (k === 'ArrowRight' || k === 'ArrowUp') nudge(1, e.shiftKey);
  else if (k === 'a' || k === 'A') setAnim(!animating);
  else if (k === 'r' || k === 'R') doRandom();
  else if (k === 'l' || k === 'L') setLoose(!loose);
  else if (k === 'd' || k === 'D') doDrop();
  else if (k === 'p' || k === 'P') setProps(!propsOn);
  else if (k === '0') doReset();
  else if (k === ' ') setPlaying(!playing);
  else if (k === 'g' || k === 'G') openGallery();
  else return;
  e.preventDefault();
  $('hint').classList.add('gone');
}

// ---- release ---------------------------------------------------------------------------------
function release() {
  released = true;
  cancelAnimationFrame(raf);
  try { if (view) view.dispose(); } catch (e) { /* gone */ }
  try { const gl = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl')); const x = gl && gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) { /* gone */ }
  try { if (S) S.dispose(); } catch (e) { /* gone */ }
  view = null; S = null;
}
addEventListener('pagehide', e => { if (!e.persisted) release(); });

window.__articraft = {
  select: choose, setLoose, setProps, drop: doDrop, animate: setAnim, random: doRandom, reset: doReset,
  get manifest() { return man; }, get entry() { return entry; }, get sim() { return S; }, get view() { return view; },
};

bindUI();
boot();
