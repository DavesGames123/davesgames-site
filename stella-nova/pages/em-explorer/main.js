// ============================================================================
//  EM EXPLORER  ·  main.js — the page shell (CORE package)
// ----------------------------------------------------------------------------
//  The page streams real volume electron microscopy data from public buckets
//  and lets the reader pan and zoom like a map. Three packages do the work:
//    view/index.js     createViewer(canvas, opts): the WebGL2 slice view
//    data/index.js     openVolume(record): the readers, the cache, the worker
//    catalog/index.js  DATASETS, BOOKMARKS, ABOUT
//  ui/mount.js imports them with import(), so a missing or broken package
//  gives a stub and a message, not a blank page. CONTRACT.md is the spec.
//
//  FLOW
//    boot()            WebGL2 test, packages, catalog, viewer, controls,
//                      then the dataset from the hash (or the default)
//    selectDataset()   openVolume, viewer.setVolume, title, slice range,
//                      places; a later call cancels an earlier one (token)
//    goBookmark()      switch dataset if needed, goTo, the caption card
//    onState()         VIEW reports the view: plane, slice, hash (throttled)
//    writeHash()       replaceState here, parent.snNav in the shell
//
//  window.__em = { viewer, catalog, volume(), selectDataset, goBookmark,
//  ready (a Promise), packages } for the saver and for tests.
//
//  grep -n targets
//    boot ............. "async function boot"
//    WebGL2 test ...... "function hasWebGL2"
//    dataset switch ... "async function selectDataset"
//    place ............ "async function goBookmark"
//    view report ...... "function onState"
//    insets ........... "function updateInsets"
//    image controls ... "function bindImage"
//    share ............ "async function share"
//    hash ............. "function writeHash" "function applyHash"
//    keys ............. "function onKey"
//    messages ......... "function showNoNet"
// ============================================================================
import { loadPackages, normalizeCatalog } from './ui/mount.js';
import { createPanel } from './ui/sheet.js';
import { renderDatasets, renderPlaces, renderAbout, renderCredits, placeTitle, creditLine, safeUrl, dsShort } from './ui/panels.js';
import { parseHash, formatHash, PLANES } from './ui/hash.js';
import { fmtVoxel, fmtExtent, fmtLength } from './ui/format.js';

const KEY = 'em-explorer';
const PHONE_Q = '(max-width: 768px), (max-height: 500px) and (pointer: coarse)';
const AXIS = { xy: 2, xz: 1, yz: 0 };            // the normal axis of each plane
const DEFAULT_CONTRAST = { lo: 0, hi: 255, gamma: 1 };

const $ = (id) => document.getElementById(id);
const isPhone = () => !!(window.matchMedia && window.matchMedia(PHONE_Q).matches);

const S = {
  pk: null, cat: null, viewer: null, volume: null, dsId: null, token: 0,
  plane: 'xy', contrast: { ...DEFAULT_CONTRAST }, auto: true, invert: false,
  bookmark: null, scope: 'here', query: '', last: null, lastHash: null,
  sliceDrag: false, hashTimer: 0, toastTimer: 0, panel: null, failed: null,
};

// ── messages ───────────────────────────────────────────────────────────────
function toast(text, url) {
  const t = $('toast');
  t.textContent = text;
  if (url) {
    const inp = document.createElement('input');
    inp.readOnly = true; inp.value = url; inp.setAttribute('aria-label', 'Link');
    t.append(inp);
    setTimeout(() => { try { inp.focus(); inp.select(); } catch (e) { /* gone */ } }, 0);
  }
  t.hidden = false;
  clearTimeout(S.toastTimer);
  S.toastTimer = setTimeout(() => { t.hidden = true; }, url ? 9000 : 2200);
}

function showNoNet(title, why) {
  $('nonetTitle').textContent = title;
  $('nonetWhy').textContent = why;
  $('nonet').hidden = false;
  setTimeout(() => { try { $('retryBtn').focus(); } catch (e) { /* gone */ } }, 0);
}

function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    const lose = gl.getExtension && gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch (e) { return false; }
}

function errText(e) {
  const m = String((e && e.message) || e || '');
  if (navigator.onLine === false) return 'Your browser is offline. Connect to the internet, then try again.';
  if (/fetch|network|load failed|cors/i.test(m)) return 'The archive did not answer. It can be busy or blocked on this network. Try again in a moment, or pick another dataset.';
  return 'The archive gave an answer the page could not read' + (m ? ` (${m.slice(0, 140)})` : '') + '. Try again, or pick another dataset.';
}

// ── layout ─────────────────────────────────────────────────────────────────
function measureTitle() {
  const r = $('title').getBoundingClientRect();
  if (r.height) document.documentElement.style.setProperty('--title-h', Math.round(r.height) + 'px');
}

function updateInsets() {
  if (!S.viewer || !S.viewer.setInsets) return;
  const W = window.innerWidth, H = window.innerHeight;
  const rect = (id) => { const el = $(id); return el && !el.hidden && el.offsetParent !== null ? el.getBoundingClientRect() : null; };
  const ins = { top: 0, right: 0, bottom: 0, left: 0 };
  const title = rect('title'), top = rect('topRight'), dock = rect('dock'), panel = S.panel && S.panel.isOpen ? rect('panel') : null;
  if (isPhone()) {
    if (title) ins.top = Math.round(title.bottom + 6);
    if (dock && dock.height) ins.bottom = Math.round(H - dock.top + 30);
    if (panel && panel.left > W / 2) ins.right = Math.round(W - panel.left);
    else if (panel && panel.top > H / 3) ins.bottom = Math.max(ins.bottom, Math.round(H - panel.top));
  } else {
    if (top) ins.top = Math.round(top.bottom + 6);
    if (panel && panel.width) ins.left = Math.round(panel.right + 8);
    ins.bottom = 42;
  }
  try { S.viewer.setInsets(ins); } catch (e) { /* VIEW */ }
}

// ── view report and hash ───────────────────────────────────────────────────
function viewState() {
  let st = S.last;
  try { if (S.viewer && S.viewer.state) st = S.viewer.state() || st; } catch (e) { /* VIEW */ }
  return st || {};
}

function currentHash() {
  const st = viewState();
  return formatHash({
    dataset: S.dsId, plane: st.plane || S.plane, x: st.x, y: st.y, z: st.z, zoom: st.zoom,
    contrast: S.auto ? null : S.contrast, invert: S.invert, bookmark: S.bookmark,
  });
}

function writeHash() {
  if (!S.dsId || document.documentElement.classList.contains('sn-saver')) return;
  const h = currentHash();
  if (h === S.lastHash) return;
  S.lastHash = h;
  try { history.replaceState(null, '', '#' + h); } catch (e) { /* sandboxed */ }
  try { if (window.parent !== window && typeof window.parent.snNav === 'function') window.parent.snNav(h, 'replace'); } catch (e) { /* other origin */ }
}

function scheduleHash() {
  clearTimeout(S.hashTimer);
  S.hashTimer = setTimeout(writeHash, 450);
}

function normalIndex(st) {
  const ax = AXIS[st.plane || S.plane];
  return [st.x, st.y, st.z][ax];
}

function onState(st) {
  if (!st) return;
  S.last = st;
  // auto window: VIEW sets it from the coarse tiles; the sliders follow it
  // (not in the saver, which fades by its own window)
  if (S.auto && st.contrast && !document.documentElement.classList.contains('sn-saver')) syncAuto(st.contrast);
  if (st.plane && st.plane !== S.plane && PLANES.includes(st.plane)) { S.plane = st.plane; syncPlane(); setSliceRange(); }
  if (!S.sliceDrag) syncSlice(normalIndex(st));
  document.body.classList.toggle('busy', !!(st.pending > 0 || st.loading));
  scheduleHash();
}

// ── image controls ─────────────────────────────────────────────────────────
function fill(input) {
  const lo = +input.min, hi = +input.max, v = +input.value;
  input.style.setProperty('--fill', (hi > lo ? ((v - lo) / (hi - lo)) * 100 : 0) + '%');
}

function showContrast() {
  const c = S.contrast;
  $('lo').value = c.lo; $('hi').value = c.hi; $('gamma').value = c.gamma;
  $('loV').textContent = String(Math.round(c.lo));
  $('hiV').textContent = String(Math.round(c.hi));
  $('gammaV').textContent = Number(c.gamma).toFixed(2);
  $('invert').checked = S.invert;
  ['lo', 'hi', 'gamma'].forEach((id) => fill($(id)));
}

// S.auto: VIEW keeps its auto window (a setContrast would stop it), so only
// the invert goes to VIEW. A user change, a catalog window or a hash window
// sets S.auto = false.
function applyContrast() {
  const c = S.contrast;
  showContrast();
  // VIEW takes the window in 0..1 (a 0..255 pair with hi <= 1 would read as 0..1)
  if (!S.auto) { try { S.viewer && S.viewer.setContrast(c.lo / 255, c.hi / 255, c.gamma); } catch (e) { /* VIEW */ } }
  try { S.viewer && S.viewer.setInvert(S.invert); } catch (e) { /* VIEW */ }
}

// the auto window (0..1) into the sliders (0..255), with no call to VIEW
function syncAuto(w) {
  if (!w || !Number.isFinite(w.lo) || !Number.isFinite(w.hi)) return;
  const lo = Math.round(w.lo * 255), hi = Math.max(lo + 1, Math.round(w.hi * 255));
  if (lo === S.contrast.lo && hi === S.contrast.hi) return;
  S.contrast = { lo, hi, gamma: S.contrast.gamma };
  showContrast();
}

// the catalog window of a dataset, or null (then VIEW's auto window)
function datasetContrast(d) {
  const c = d && d.contrast;
  return c && Number.isFinite(c.lo) && Number.isFinite(c.hi) && c.hi > c.lo ? { lo: c.lo, hi: c.hi, gamma: Number.isFinite(c.gamma) ? c.gamma : 1 } : null;
}

function resetContrast(d) {
  const c = datasetContrast(d);
  S.auto = !c;
  S.contrast = c || { ...DEFAULT_CONTRAST };
}

function bindImage() {
  const lo = $('lo'), hi = $('hi'), g = $('gamma');
  lo.addEventListener('input', () => {
    S.auto = false;
    S.contrast.lo = Math.min(+lo.value, S.contrast.hi - 1);
    applyContrast(); scheduleHash();
  });
  hi.addEventListener('input', () => {
    S.auto = false;
    S.contrast.hi = Math.max(+hi.value, S.contrast.lo + 1);
    applyContrast(); scheduleHash();
  });
  g.addEventListener('input', () => { S.auto = false; S.contrast.gamma = +g.value; applyContrast(); scheduleHash(); });
  $('invert').addEventListener('change', () => { S.invert = $('invert').checked; applyContrast(); scheduleHash(); });
  $('resetImage').addEventListener('click', () => {
    resetContrast(dataset()); S.invert = false; applyContrast();
    if (S.auto) { try { const w = S.viewer && S.viewer.autoContrast && S.viewer.autoContrast(); if (w) syncAuto(w); } catch (e) { /* VIEW */ } }
    scheduleHash();
  });
  $('threeView').addEventListener('change', () => {
    try { S.viewer && S.viewer.setLayout && S.viewer.setLayout($('threeView').checked ? 'three' : 'single'); } catch (e) { /* VIEW */ }
  });

  const sl = $('slice');
  sl.addEventListener('pointerdown', () => { S.sliceDrag = true; });
  const up = () => { S.sliceDrag = false; };
  sl.addEventListener('pointerup', up); sl.addEventListener('pointercancel', up); sl.addEventListener('change', up);
  sl.addEventListener('input', () => {
    const s0 = scale0(); if (!s0) return;
    const ax = AXIS[S.plane], i = +sl.value;
    syncSlice(i);
    try { S.viewer.setSlice((i + 0.5) * s0.resolution[ax]); } catch (e) { /* VIEW */ }
  });

  for (const segId of ['planeSeg', 'planeSeg2']) {
    $(segId).querySelectorAll('[data-plane]').forEach((b) => b.addEventListener('click', () => setPlane(b.dataset.plane)));
  }
}

function setPlane(p) {
  if (!PLANES.includes(p)) return;
  S.plane = p;
  syncPlane();
  setSliceRange();
  try { S.viewer && S.viewer.setPlane(p); } catch (e) { /* VIEW */ }
  scheduleHash();
}

function syncPlane() {
  for (const segId of ['planeSeg', 'planeSeg2']) {
    $(segId).querySelectorAll('[data-plane]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.plane === S.plane)));
  }
}

function scale0() {
  const v = S.volume;
  return v && Array.isArray(v.scales) && v.scales[0] && Array.isArray(v.scales[0].size) ? v.scales[0] : null;
}

function setSliceRange() {
  const s0 = scale0(), sl = $('slice');
  if (!s0) return;
  const ax = AXIS[S.plane];
  sl.max = String(Math.max(0, Math.round(s0.size[ax]) - 1));
  syncSlice(normalIndex(viewState()));
}

function syncSlice(i) {
  const s0 = scale0(), sl = $('slice');
  if (!s0 || !Number.isFinite(i)) return;
  const ax = AXIS[S.plane];
  sl.value = String(Math.round(i));
  fill(sl);
  $('sliceV').textContent = `${fmtLength(Math.round(i) * s0.resolution[ax])} · slice ${Math.round(i).toLocaleString('en-US')}`;
}

// ── datasets and places ────────────────────────────────────────────────────
function dataset(id = S.dsId) { return S.cat ? S.cat.datasets.find((d) => d.id === id) || null : null; }
function bookmark(id) { return S.cat ? S.cat.bookmarks.find((b) => b.id === id) || null : null; }

function renderLists() {
  if (!S.cat) return;
  renderDatasets($('dsList'), S.cat.datasets, S.dsId, (id) => {
    if (id !== S.dsId) selectDataset(id, { view: null });
    if (isPhone()) S.panel.close();
  });
  renderPlacesNow();
}

function renderPlacesNow() {
  const here = S.cat.bookmarks.some((b) => b.dataset === S.dsId);
  const scope = here ? S.scope : 'all';
  const n = renderPlaces($('placeList'), S.cat.bookmarks, S.cat.datasets, {
    query: S.query, scope, currentDataset: S.dsId, activeId: S.bookmark, onPick: (id) => goBookmark(id),
  });
  $('placeEmpty').hidden = n > 0;
  $('placeEmpty').textContent = S.cat.bookmarks.length ? 'No places match. Try a different word.' : 'No places yet.';
  $('placeScope').querySelectorAll('[data-scope]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.scope === scope)));
}

// The record gives the voxel size and the extent; the opened volume fills them in when it does not.
function setTitle(d, vol) {
  const s0 = vol && Array.isArray(vol.scales) ? vol.scales[0] : null;
  const voxel = (d && d.voxel) || (s0 && s0.resolution), size = (d && d.size) || (s0 && s0.size);
  $('dsName').textContent = d ? d.name || d.id : 'Electron microscopy explorer';
  const ext = d ? fmtExtent(size, voxel) : '';
  $('dsMeta').textContent = d ? [d.organism && d.tissue ? `${d.organism}, ${d.tissue}` : d.organism || d.tissue, d.method, fmtVoxel(voxel) && `${fmtVoxel(voxel)} voxels`, ext].filter(Boolean).join(' · ') : '';
  $('credit').textContent = d ? 'Data: ' + creditLine(d) : '';
  measureTitle();
}

async function selectDataset(id, { view = null } = {}) {
  const d = dataset(id);
  if (!d) return false;
  const token = ++S.token;
  const prev = S.dsId;
  S.dsId = id;
  if (prev !== id) {
    if (S.bookmark && (bookmark(S.bookmark) || {}).dataset !== id) closeCaption();
    resetContrast(d); S.invert = false;
  }
  setTitle(d);
  renderLists();
  $('nonet').hidden = true;
  $('loadingText').textContent = `Opening ${dsShort(d)}`;
  $('loading').hidden = false;
  document.body.classList.add('busy');
  let vol;
  try {
    vol = await S.pk.data.openVolume(d);
  } catch (e) {
    if (token !== S.token) return false;
    $('loading').hidden = true; document.body.classList.remove('busy');
    S.failed = { id, view };
    showNoNet('The data did not load', errText(e));
    return false;
  }
  if (token !== S.token) { try { vol && vol.dispose && vol.dispose(); } catch (e) { /* DATA */ } return false; }
  const old = S.volume;
  S.volume = vol;
  try { S.viewer.setVolume(vol); } catch (e) { console.error(e); }
  if (old && old !== vol) { try { old.dispose && old.dispose(); } catch (e) { /* DATA */ } }
  setTitle(d, vol);
  applyContrast();
  // no view from a hash or a place: the catalog's first view of the dataset
  if (!(view && [view.x, view.y, view.z].every(Number.isFinite)) && d.home && [d.home.x, d.home.y, d.home.z].every(Number.isFinite)) {
    view = { ...d.home, plane: d.home.plane || S.plane };
  }
  if (view && [view.x, view.y, view.z].every(Number.isFinite)) {
    const plane = PLANES.includes(view.plane) ? view.plane : S.plane;
    S.plane = plane; syncPlane();
    try { S.viewer.goTo({ x: view.x, y: view.y, z: view.z, zoom: view.zoom, plane }); } catch (e) { /* VIEW */ }
  } else {
    try { S.viewer.setPlane(S.plane); } catch (e) { /* VIEW */ }
  }
  setSliceRange();
  $('loading').hidden = true;
  document.body.classList.remove('busy', 'booting');
  updateInsets();
  scheduleHash();
  return true;
}

function showCaption(b) {
  const d = dataset(b.dataset);
  $('capDs').textContent = d ? dsShort(d) : '';
  $('capTitle').textContent = placeTitle(b);
  $('capText').textContent = b.caption || '';
  const src = safeUrl(b.source);
  $('capSrc').hidden = !src;
  if (src) $('capSrc').href = src;
  $('caption').hidden = false;
}

function closeCaption() {
  S.bookmark = null;
  $('caption').hidden = true;
  if (S.cat) renderPlacesNow();
  scheduleHash();
}

async function goBookmark(id) {
  const b = bookmark(id);
  if (!b) return false;
  S.bookmark = b.id;
  showCaption(b);
  const view = { x: b.x, y: b.y, z: b.z, zoom: b.zoom, plane: b.plane || 'xy' };
  if (isPhone() && S.panel) S.panel.close();
  if (b.dataset !== S.dsId || !S.volume) {
    const ok = await selectDataset(b.dataset, { view });
    renderPlacesNow();
    return ok;
  }
  if (PLANES.includes(view.plane)) { S.plane = view.plane; syncPlane(); }
  // same dataset: a smooth flight (zoom out, across, in), like a map
  try { S.viewer.goTo({ ...view, animate: !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) }); } catch (e) { /* VIEW */ }
  setSliceRange();
  renderPlacesNow();
  scheduleHash();
  return true;
}

function stepPlace(dir) {
  const all = S.cat ? S.cat.bookmarks : [];
  if (!all.length) return;
  const here = all.filter((b) => b.dataset === S.dsId);
  const list = here.length ? here : all;
  const i = list.findIndex((b) => b.id === S.bookmark);
  const n = list[(i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length)];
  goBookmark(n.id);
}

// ── hash in ────────────────────────────────────────────────────────────────
function applyHash(hash, first) {
  const p = parseHash(hash);
  if (p.contrast) { S.contrast = p.contrast; S.auto = false; }
  if (p.invert != null) S.invert = p.invert;
  if (p.plane) S.plane = p.plane;
  const view = [p.x, p.y, p.z].every(Number.isFinite) ? { x: p.x, y: p.y, z: p.z, zoom: p.zoom, plane: p.plane } : null;
  const b = p.bookmark && bookmark(p.bookmark);
  if (b && (!p.dataset || p.dataset === b.dataset)) {
    S.bookmark = b.id; showCaption(b);
  }
  const id = p.dataset && dataset(p.dataset) ? p.dataset : first ? S.cat.defaultId : S.dsId;
  if (!id) return Promise.resolve(false);
  if (b && !view && (!p.dataset || p.dataset === b.dataset)) return goBookmark(b.id);
  if (id !== S.dsId || first) {
    const keep = { ...S.contrast }, inv = S.invert;
    return selectDataset(id, { view }).then((ok) => {
      if (p.contrast) { S.contrast = keep; S.auto = false; S.invert = inv; applyContrast(); }
      else if (p.invert != null) { S.invert = inv; applyContrast(); }
      return ok;
    });
  }
  applyContrast();
  syncPlane();
  if (view) { try { S.viewer.goTo({ ...view, plane: view.plane || S.plane }); } catch (e) { /* VIEW */ } }
  else if (p.plane) { try { S.viewer.setPlane(p.plane); } catch (e) { /* VIEW */ } }
  setSliceRange();
  return Promise.resolve(true);
}

// ── share ──────────────────────────────────────────────────────────────────
function shareUrl() {
  const h = currentHash();
  try {
    const P = window.parent;
    if (P && P !== window && P.snShare && typeof P.snShare.url === 'function') return P.snShare.url('#' + KEY + '/' + h);
  } catch (e) { /* other origin */ }
  return location.href.split('#')[0] + '#' + h;
}

async function share() {
  writeHash();
  const url = shareUrl();
  const d = dataset();
  const b = S.bookmark && bookmark(S.bookmark);
  const title = b ? `${placeTitle(b)} · Electron Microscopy Explorer` : `${d ? d.name : 'Electron microscopy'} · Electron Microscopy Explorer`;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (coarse && navigator.share) {
    try { await navigator.share({ title, url }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
      toast('Link copied. It opens this view.');
      return 'copied';
    }
  } catch (e) { /* no permission */ }
  toast('Copy this link:', url);
  return 'shown';
}

// ── about sheet ────────────────────────────────────────────────────────────
let aboutReturn = null;
function openAbout(part) {
  aboutReturn = document.activeElement;
  $('about').hidden = false;
  const card = $('about').querySelector('.about-card');
  if (part === 'credits') $('creditsTitle').scrollIntoView && $('creditsTitle').scrollIntoView({ block: 'start' });
  else card.scrollTop = 0;
  try { $('aboutClose').focus(); } catch (e) { /* gone */ }
}
function closeAbout() {
  $('about').hidden = true;
  try { aboutReturn && aboutReturn.focus && aboutReturn.focus(); } catch (e) { /* gone */ }
}

// ── keys ───────────────────────────────────────────────────────────────────
function onKey(e) {
  if (e.key === 'Escape') {
    if (!$('about').hidden) { closeAbout(); e.preventDefault(); return; }
    if (!$('toast').hidden) { $('toast').hidden = true; return; }
    if (isPhone() && S.panel && S.panel.isOpen) { S.panel.close(); return; }
    if (!$('caption').hidden) { closeCaption(); return; }
    return;
  }
  const t = e.target, tag = t && t.tagName;
  if (tag === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox') return;
  if (tag === 'TEXTAREA' || (t && t.isContentEditable) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!$('about').hidden) {
    if (e.key === 'Tab') trapFocus(e);
    return;
  }
  const k = e.key;
  if (k === '1' || k === '2' || k === '3') { setPlane(PLANES[+k - 1]); e.preventDefault(); }
  else if (k === 'n' || k === 'N') { stepPlace(1); e.preventDefault(); }
  else if (k === 'p' || k === 'P') { stepPlace(-1); e.preventDefault(); }
  else if (k === 'i' || k === 'I') { S.invert = !S.invert; applyContrast(); scheduleHash(); e.preventDefault(); }
  else if (k === '?') { openAbout(); e.preventDefault(); }
}

function trapFocus(e) {
  const f = [...$('about').querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hidden);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
  else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
}

// ── boot ───────────────────────────────────────────────────────────────────
function bindShell() {
  S.panel = createPanel({ panel: $('panel'), grip: $('sheetGrip'), closeBtn: $('panelClose'), openBtn: $('panelOpen'), dock: $('dock') }, {
    onChange: () => { requestAnimationFrame(updateInsets); setTimeout(updateInsets, 340); },
  });
  if (isPhone()) S.panel.close();

  $('placeSearch').addEventListener('input', () => { S.query = $('placeSearch').value; if (S.cat) renderPlacesNow(); });
  $('placeScope').querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => { S.scope = b.dataset.scope; renderPlacesNow(); }));
  $('shareBtn').addEventListener('click', share);
  $('dockShare').addEventListener('click', share);
  $('aboutBtn').addEventListener('click', () => openAbout());
  $('aboutLink').addEventListener('click', () => openAbout());
  $('creditsLink').addEventListener('click', () => openAbout('credits'));
  $('credit').addEventListener('click', () => openAbout('credits'));
  $('aboutClose').addEventListener('click', closeAbout);
  $('about').addEventListener('click', (e) => { if (e.target === $('about')) closeAbout(); });
  $('capClose').addEventListener('click', closeCaption);
  $('capPrev').addEventListener('click', () => stepPlace(-1));
  $('capNext').addEventListener('click', () => stepPlace(1));
  $('retryBtn').addEventListener('click', () => {
    $('nonet').hidden = true;
    if (!S.cat || !S.viewer) { location.reload(); return; }
    const f = S.failed || { id: S.dsId, view: null };
    selectDataset(f.id, { view: f.view });
  });
  $('otherDsBtn').addEventListener('click', () => { $('nonet').hidden = true; if (S.panel) S.panel.open('data'); });
  document.addEventListener('keydown', onKey);

  const net = () => { $('offline').hidden = navigator.onLine !== false; };
  window.addEventListener('online', net);
  window.addEventListener('offline', net);
  net();

  let rz = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => { measureTitle(); try { S.viewer && S.viewer.resize(); } catch (e) { /* VIEW */ } updateInsets(); });
  });
  window.addEventListener('hashchange', () => {
    const h = location.hash.replace(/^#/, '');
    if (h === S.lastHash || !S.cat || !S.viewer) return;
    S.lastHash = h;
    applyHash(h, false);
  });
}

async function boot() {
  bindShell();
  bindImage();
  measureTitle();
  applyContrast();

  const gl2 = hasWebGL2();
  // tests can hand in their own packages (window.__emTestPackages)
  const given = window.__emTestPackages;
  S.pk = given ? { errors: [], ...given } : await loadPackages((p) => import(p), '.');
  for (const { pkg, error } of S.pk.errors) console.warn(`em-explorer: ${pkg} package not loaded, using a stub:`, error && error.message);
  S.cat = normalizeCatalog(S.pk.catalog);
  renderAbout($('aboutBody'), S.cat.about);
  renderCredits($('creditsBody'), S.cat.datasets);
  if (S.pk.data.setPhone) { try { S.pk.data.setPhone(isPhone()); } catch (e) { /* DATA */ } }

  if (!gl2) {
    $('nogl').hidden = false;
    setTitle(dataset(S.cat.defaultId));
    renderLists();
    return false;
  }
  try {
    S.viewer = S.pk.view.createViewer($('view'), { source: S.pk.data, onState, overlay: true, minimap: true, insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  } catch (e) {
    console.error(e);
    $('nogl').hidden = false;
    setTitle(dataset(S.cat.defaultId));
    renderLists();
    return false;
  }
  window.__em.viewer = S.viewer;
  updateInsets();

  // a package that did not import leaves a stub; say so, the page cannot show data
  if (S.pk.errors.length) {
    showNoNet('Part of the page did not load', `The ${S.pk.errors.map((x) => x.pkg).join(' and ')} code did not load. Check the connection, then try again.`);
  }
  const ok = await applyHash(location.hash, true);
  document.body.classList.remove('booting');
  return ok;
}

window.__em = {
  get viewer() { return S.viewer; }, set viewer(v) { S.viewer = v; },
  get catalog() { return S.cat; },
  get packages() { return S.pk; },
  volume: () => S.volume,
  state: () => ({ dataset: S.dsId, plane: S.plane, contrast: { ...S.contrast }, auto: S.auto, invert: S.invert, bookmark: S.bookmark, view: viewState() }),
  selectDataset: (id, o) => selectDataset(id, o || {}),
  goBookmark: (id) => goBookmark(id),
  share, shareUrl, setPlane,
  // the saver puts back the reader's image: contrast 0..255 (null = auto)
  setImage({ contrast, invert } = {}) {
    if (contrast && Number.isFinite(contrast.lo) && Number.isFinite(contrast.hi)) { S.contrast = { gamma: 1, ...contrast }; S.auto = false; }
    else if (contrast === null) S.auto = true;
    if (invert != null) S.invert = !!invert;
    applyContrast();
    if (S.auto) { try { const w = S.viewer && S.viewer.autoContrast && S.viewer.autoContrast(); if (w) syncAuto(w); } catch (e) { /* VIEW */ } }
  },
  ready: null,
};

// gpu-guard owns __snRelease; the viewer also stops its own work first
const guardRelease = window.__snRelease;
window.__snRelease = function () {
  try { S.viewer && S.viewer.dispose(); } catch (e) { /* VIEW */ }
  try { S.volume && S.volume.dispose && S.volume.dispose(); } catch (e) { /* DATA */ }
  if (typeof guardRelease === 'function') return guardRelease.apply(this, arguments);
};

window.__em.ready = boot().catch((e) => {
  console.error(e);
  showNoNet('The page did not start', String((e && e.message) || e).slice(0, 200));
  return false;
});
import('./saver/index.js').catch((e) => console.warn('em-explorer: saver not loaded', e));
