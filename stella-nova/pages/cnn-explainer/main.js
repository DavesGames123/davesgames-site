// ============================================================================
//  CNN EXPLAINER  ·  main.js  boot, state and the network overview
// ----------------------------------------------------------------------------
//  Boot: load model/weights.bin and examples/examples.bin, run the first
//  example (an espresso, as in the original tool) through net.js, paint
//  every map (maps.js) and draw the overview (draw.js) on #netCv. Then the
//  explainer column (explain.js), the detail view (detail.js), the photo
//  strip, the upload and camera, the colours pop-up and the credits.
//
//  window.cnnPage is the page API: the detail view, the explainer and
//  saver.js call it, and the node tests read it.
//
//  Tests: window.__cnnLoadBytes(url) replaces fetch (jsdom has no file
//  fetch), and window.__cnnNoAutoBoot stops the boot at import.
//
//  grep -n 'export async function boot'   the boot order
//  grep -n 'function run'                 one picture through the network
//  grep -n 'function drawNet'             the overview frame
//  grep -n 'function relayout'            canvas size and the layout
//  grep -n 'function onPointer'           hover, tip and click
//  grep -n 'function onKey'               keyboard on the overview
//  grep -n 'function buildStrip'          example photos, upload, camera
//  grep -n 'function buildCredits'        the credits drawer
//  grep -n 'SAVER SEAM'                   saver.js
// ============================================================================
import { parseWeights, forward, CLASSES, ARCH } from './net.js';
import { EXAMPLES, SOURCE, exampleRGB } from './data.js';
import { coverResample, rgbToRGBA } from './image.js';
import { layoutNet, hitTest, GRID } from './layout.js';
import { drawNetwork } from './draw.js';
import { createMaps } from './maps.js';
import { SCALES } from './colour.js';
import { createDetail } from './detail.js';
import { createExplain } from './explain.js';
import { mountGradientPicker } from '../../lib/growth-gradients.js';
import { mountSheet } from '../../lib/sn-panel.js';
import { installSaver } from './saver.js';

export const PHONE_QUERY = '(max-width: 768px), (max-height: 500px) and (pointer: coarse)';
const DEFAULT_EXAMPLE = 12;   // espresso
const STORE = 'sn-cnn-explainer';

function store(get, val) {
  try {
    if (get) return JSON.parse(localStorage.getItem(STORE) || '{}');
    localStorage.setItem(STORE, JSON.stringify(val));
  } catch (e) { /* no storage: defaults */ }
  return {};
}

export async function boot() {
  const doc = document, win = window, $ = id => doc.getElementById(id);
  const mq = win.matchMedia ? win.matchMedia(PHONE_QUERY) : { matches: false, addEventListener() {} };
  const rm = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const saved = store(true);
  const S = {
    W: null, bin: null, result: null, rgb: null, pick: DEFAULT_EXAMPLE, own: null,
    grad: saved.grad || 'magma', rev: !!saved.rev, scale: saved.scale || 'layer',
    L: null, hover: null, focus: { li: 1, c: 0 }, reveal0: 0, raf: 0, booted: false, failed: null,
  };
  const loadBytes = win.__cnnLoadBytes || (async url => { const r = await fetch(url); if (!r.ok) throw new Error(url + ': HTTP ' + r.status); return new Uint8Array(await r.arrayBuffer()); });
  const maps = createMaps(doc);
  const cv = $('netCv'), g = cv.getContext('2d'), wrap = $('netWrap'), tip = $('netTip'), live = $('netLive');

  // ── page API ─────────────────────────────────────────────────────────────
  const page = {
    get state() { return S; },
    result: () => S.result,
    maps: () => maps,
    reducedMotion: () => !!rm.matches,
    sceneContext(spec) {
      if (!S.result) return null;
      const li = Math.max(0, Math.min(11, spec.li | 0));
      const c = li === 11 ? (spec.c == null ? S.result.top : spec.c) : li === 0 ? -1 : Math.max(0, Math.min(9, spec.c | 0));
      return { result: S.result, W: S.W, maps, li, c, ci: spec.ci };
    },
    openDetail(spec) {
      if (mq.matches && sheet && sheet.open) sheet.setOpen(false);
      S.focus = spec.li === 11 ? { bar: spec.c == null ? S.result.top : spec.c } : { li: spec.li, c: spec.li === 0 ? -1 : spec.c };
      detail.open(spec); requestDraw();
    },
    openCredits,
    focusOverview() { cv.focus && cv.focus(); },
    onDetail() { requestDraw(); },
    run, runExample, relayout, requestDraw,
    examples: EXAMPLES,
  };
  win.cnnPage = page;

  // ── load ─────────────────────────────────────────────────────────────────
  try {
    const [wb, eb] = await Promise.all([
      loadBytes(new URL('model/weights.bin', import.meta.url).href),
      loadBytes(new URL('examples/examples.bin', import.meta.url).href),
    ]);
    S.W = parseWeights(wb); S.bin = eb;
  } catch (e) {
    S.failed = e;
    $('pred').innerHTML = '<span class="pred-word">The network did not load. Reload the page to try again.</span>';
    console.warn('cnn-explainer: load', e);
    return page;
  }

  // ── panels ──────────────────────────────────────────────────────────────
  const learnEl = $('learn');
  let sheet = null;
  const detail = createDetail({ doc, win, page });
  const explain = createExplain({ doc, win, host: $('learnBody'), page });
  sheet = mountSheet({ panel: learnEl, grip: $('sheetGrip'), menu: $('dockLearn'), close: $('learnClose'), phoneQ: mq, doc,
    onOpen: () => win.setTimeout(relayout, 340) });
  buildStrip();
  buildView();
  buildCredits();

  // ── one picture ──────────────────────────────────────────────────────────
  function run(rgb, meta = {}) {
    S.rgb = rgb;
    S.result = forward(S.W, rgb);
    maps.set(S.result, { grad: S.grad, rev: S.rev, scale: S.scale });
    const p = S.result.probs, order = p.map((v, i) => i).sort((a, b) => p[b] - p[a]);
    const pc = v => (v * 100).toFixed(v >= 0.1 ? 1 : 2) + '%';
    $('pred').innerHTML = `<span class="pred-word">It sees</span><span class="pred-cls"></span><span class="pred-p"></span><span class="pred-2"></span>`;
    $('pred').querySelector('.pred-cls').textContent = CLASSES[order[0]];
    $('pred').querySelector('.pred-p').textContent = pc(p[order[0]]);
    $('pred').querySelector('.pred-2').textContent = `then ${CLASSES[order[1]]} ${pc(p[order[1]])}`;
    S.reveal0 = rm.matches || meta.instant ? -1 : performanceNow();
    detail.refresh(); explain.refresh();
    requestDraw();
    return S.result;
  }
  function runExample(i) {
    S.pick = i; S.own = null;
    markStrip();
    return run(exampleRGB(S.bin, i), { label: EXAMPLES[i].cls });
  }
  function performanceNow() { return win.performance ? win.performance.now() : Date.now(); }
  // the network lights up from left to right after a new picture
  function reveal(li) {
    if (S.reveal0 < 0) return 1;
    const t = (performanceNow() - S.reveal0) / 1000;
    return Math.max(0, Math.min(1, (t * 2.4 - li * 0.16) / 0.5));
  }

  // ── overview canvas ──────────────────────────────────────────────────────
  function relayout() {
    const phone = mq.matches;
    const w = Math.max(240, wrap.clientWidth || (phone ? 360 : 1100));
    const h = phone ? 0 : Math.max(300, wrap.clientHeight || 640);
    S.L = layoutNet(w, h, phone || w < 720 ? 'v' : 'h');
    const dpr = Math.min(2, win.devicePixelRatio || 1);
    const ch = S.L.orient === 'v' ? S.L.h : h;
    if (S.L.orient === 'v') { cv.style.height = ch + 'px'; wrap.style.height = ch + 'px'; } else { cv.style.height = ''; wrap.style.height = ''; }
    cv.width = Math.round(w * dpr); cv.height = Math.round(ch * dpr);
    S.dpr = dpr; S.cw = w; S.ch = ch;
    requestDraw();
  }
  function requestDraw() { if (!S.raf) S.raf = win.requestAnimationFrame(drawNet); }
  function drawNet() {
    S.raf = 0;
    if (!g || !S.L || !S.result) return;
    g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    g.clearRect(0, 0, S.cw, S.ch);
    const showFocus = doc.activeElement === cv || detail.isOpen;
    drawNetwork(g, S.L, { maps, result: S.result, hover: S.hover, focus: showFocus ? S.focus : null, reveal,
      barT: S.reveal0 < 0 ? 1 : Math.max(0, Math.min(1, ((performanceNow() - S.reveal0) / 1000 - 0.9) / 0.6)) });
    if (S.reveal0 >= 0 && performanceNow() - S.reveal0 < 1700) requestDraw();
  }

  function cellValue(li, c, gy, gx) {
    const L = S.result.layers[li];
    return li === 0 ? L.data[(gy * 64 + gx) * 3 + Math.max(0, c)] : L.data[(gy * L.W + gx) * L.C + c];
  }
  function tipText(h) {
    if (h.kind === 'bar') return `${CLASSES[h.i]} · <b>${(S.result.probs[h.i] * 100).toFixed(2)}%</b>`;
    const name = ARCH[h.li].label, ch = h.li === 0 ? (h.c < 0 ? 'picture' : ['red', 'green', 'blue'][h.c]) : `map ${h.c + 1}`;
    if (h.li === 0 && h.c < 0) {
      const v = [0, 1, 2].map(k => Math.round(cellValue(0, k, h.gy, h.gx) * 255));
      return `${name} · ${ch} · (${h.gy}, ${h.gx}) <b>${v.join(' ')}</b>`;
    }
    return `${name} · ${ch} · (${h.gy}, ${h.gx}) <b>${cellValue(h.li, h.c, h.gy, h.gx).toFixed(3)}</b>`;
  }
  function onPointer(e) {
    if (!S.L || !S.result) return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const h = hitTest(S.L, x, y);
    const key = h ? JSON.stringify(h) : '';
    if (key !== S.hoverKey) { S.hoverKey = key; S.hover = h; requestDraw(); }
    if (h && e.pointerType !== 'touch') {
      tip.hidden = false; tip.innerHTML = tipText(h);
      const tw = tip.offsetWidth || 160;
      tip.style.left = Math.min(r.width - tw - 6, x + 14) + 'px'; tip.style.top = (y + 16) + 'px';
    } else tip.hidden = true;
  }
  function onLeave() { S.hover = null; S.hoverKey = ''; tip.hidden = true; requestDraw(); }
  function onClick(e) {
    if (!S.L) return;
    const r = cv.getBoundingClientRect(), h = hitTest(S.L, e.clientX - r.left, e.clientY - r.top);
    if (!h) return;
    if (h.kind === 'bar') page.openDetail({ li: 11, c: h.i });
    else page.openDetail({ li: h.li, c: h.c, gy: h.gy, gx: h.gx });
  }
  // keyboard: Left and Right move between layers, Up and Down between maps
  function onKey(e) {
    const f = S.focus.bar != null ? { li: 11, c: S.focus.bar } : { li: S.focus.li, c: S.focus.c };
    let { li, c } = f;
    const n = l => (l === 0 ? 4 : 10), idx = l => (l === 0 ? c + 1 : c);
    if (e.key === 'ArrowRight') { li = Math.min(11, li + 1); c = Math.min(9, Math.max(0, li === 0 ? c : c)); }
    else if (e.key === 'ArrowLeft') { li = Math.max(0, li - 1); if (li === 0) c = Math.min(2, Math.max(-1, c)); }
    else if (e.key === 'ArrowDown') { const k = Math.min(n(li) - 1, idx(li) + 1); c = li === 0 ? k - 1 : k; }
    else if (e.key === 'ArrowUp') { const k = Math.max(0, idx(li) - 1); c = li === 0 ? k - 1 : k; }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); page.openDetail({ li, c: li === 11 ? c : c }); return; }
    else return;
    e.preventDefault();
    if (li !== 0 && c < 0) c = 0;
    S.focus = li === 11 ? { bar: Math.max(0, c) } : { li, c };
    const what = li === 11 ? `Output, ${CLASSES[Math.max(0, c)]}, ${(S.result.probs[Math.max(0, c)] * 100).toFixed(1)} percent`
      : li === 0 ? `Input, ${c < 0 ? 'the picture' : ['red', 'green', 'blue'][c] + ' channel'}` : `${ARCH[li].label}, map ${c + 1} of 10, ${GRID[li]} by ${GRID[li]}`;
    live.textContent = what + '. Enter opens it.';
    requestDraw();
  }
  cv.addEventListener('pointermove', onPointer);
  cv.addEventListener('pointerleave', onLeave);
  cv.addEventListener('click', onClick);
  cv.addEventListener('keydown', onKey);
  cv.addEventListener('focus', requestDraw);
  cv.addEventListener('blur', requestDraw);
  doc.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!$('viewPop').hidden) toggleView(false);
      else if (!$('credits').hidden) closeCredits();
      else if (detail.isOpen) { detail.close(); cv.focus && cv.focus(); }
    }
  });
  if ('ResizeObserver' in win) new win.ResizeObserver(() => relayout()).observe(wrap);
  win.addEventListener('resize', relayout);
  if (mq.addEventListener) mq.addEventListener('change', relayout);

  // ── photo strip, upload and camera ──────────────────────────────────────
  function thumb(rgb, size = 64) {
    const c2 = doc.createElement('canvas'); c2.width = size; c2.height = size;
    const x = c2.getContext('2d');
    if (x) { const id = x.createImageData(64, 64); rgbToRGBA(rgb, id.data); x.putImageData(id, 0, 0); }
    return c2;
  }
  function buildStrip() {
    const host = $('stripEx');
    EXAMPLES.forEach((ex, i) => {
      const b = doc.createElement('button');
      b.type = 'button'; b.className = 'ex-btn'; b.dataset.i = i;
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
      b.setAttribute('aria-label', `${ex.cls}, example ${i % 2 + 1}`);
      b.title = `${ex.cls} · photo: ${ex.author} (${ex.licence})`;
      b.appendChild(thumb(exampleRGB(S.bin, i)));
      b.addEventListener('click', () => runExample(i));
      host.appendChild(b);
    });
    $('upload').addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      try { runOwn(await fileToRGB(f), 'your photo'); } catch (err) { toast('That file did not open as a picture.'); }
    });
    $('camBtn').addEventListener('click', openCam);
    $('camCancel').addEventListener('click', closeCam);
    $('camTake').addEventListener('click', takeCam);
    $('dockPhotos').addEventListener('click', () => { $('stage').scrollTo ? $('stage').scrollTo({ top: 0, behavior: 'smooth' }) : 0; const b = host.querySelector('[aria-checked="true"]') || host.firstChild; b && b.focus(); });
  }
  function markStrip() {
    for (const b of $('stripEx').querySelectorAll('.ex-btn')) b.setAttribute('aria-checked', String(!S.own && +b.dataset.i === S.pick));
    const own = $('stripEx').querySelector('.own'); if (own) own.setAttribute('aria-checked', String(!!S.own));
  }
  function runOwn(rgb, name) {
    S.own = rgb;
    let b = $('stripEx').querySelector('.own');
    if (!b) {
      b = doc.createElement('button'); b.type = 'button'; b.className = 'ex-btn own'; b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', 'Your picture');
      b.addEventListener('click', () => { if (S.own) { markStrip(); run(S.own); } });
      $('stripEx').prepend(b);
    }
    b.replaceChildren(thumb(rgb));
    markStrip();
    run(rgb, { label: name });
  }
  async function fileToRGB(file) {
    let src, w, h;
    if (win.createImageBitmap) { src = await win.createImageBitmap(file); w = src.width; h = src.height; }
    else {
      src = await new Promise((res, rej) => { const im = new win.Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); });
      w = src.naturalWidth; h = src.naturalHeight;
    }
    return sourceToRGB(src, w, h);
  }
  function sourceToRGB(src, w, h) {
    const k = Math.min(1, 512 / Math.max(w, h)), cw = Math.max(1, Math.round(w * k)), chh = Math.max(1, Math.round(h * k));
    const c2 = doc.createElement('canvas'); c2.width = cw; c2.height = chh;
    const x = c2.getContext('2d'); x.drawImage(src, 0, 0, cw, chh);
    return coverResample(x.getImageData(0, 0, cw, chh).data, cw, chh, 64);
  }
  let camStream = null;
  async function openCam() {
    const md = win.navigator.mediaDevices;
    if (!md || !md.getUserMedia) { const u = $('upload'); u.setAttribute('capture', 'environment'); u.click(); u.removeAttribute('capture'); return; }
    try {
      camStream = await md.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 640 } }, audio: false });
      const v = $('camVideo'); v.srcObject = camStream; await v.play().catch(() => {});
      $('cam').hidden = false; $('camTake').focus();
    } catch (e) { toast('The camera is not available. Pick a photo instead.'); }
  }
  function closeCam() { if (camStream) camStream.getTracks().forEach(t => t.stop()); camStream = null; $('cam').hidden = true; $('camBtn').focus(); }
  function takeCam() {
    const v = $('camVideo');
    if (v.videoWidth) runOwn(sourceToRGB(v, v.videoWidth, v.videoHeight), 'your snapshot');
    closeCam();
  }

  // ── colours pop-up ──────────────────────────────────────────────────────
  function buildView() {
    mountGradientPicker($('gradHost'), { value: S.grad, reversed: S.rev, label: 'Choose a gradient',
      ids: ['magma', 'inferno', 'viridis', 'plasma', 'cividis', 'turbo', 'ice', 'ember', 'aurora', 'mono'],
      onChange(id, rev) { S.grad = id; S.rev = rev; applyColours(); } });
    const seg = $('scaleSeg');
    for (const s of SCALES) {
      const b = doc.createElement('button'); b.type = 'button'; b.textContent = s.label; b.dataset.id = s.id; b.setAttribute('role', 'radio');
      b.addEventListener('click', () => { S.scale = s.id; applyColours(); });
      seg.appendChild(b);
    }
    markScale();
    $('viewBtn').addEventListener('click', () => toggleView());
    $('dockView').addEventListener('click', () => toggleView());
  }
  function markScale() { for (const b of $('scaleSeg').children) { const on = b.dataset.id === S.scale; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); } }
  function applyColours() {
    maps.set(null, { grad: S.grad, rev: S.rev, scale: S.scale });
    markScale(); store(false, { grad: S.grad, rev: S.rev, scale: S.scale });
    explain.refresh(); requestDraw(); if (detail.isOpen) detail.draw();
  }
  function toggleView(on) {
    const p = $('viewPop'); on = on == null ? p.hidden : on;
    p.hidden = !on;
    $('viewBtn').setAttribute('aria-expanded', String(on)); $('dockView').setAttribute('aria-expanded', String(on));
    if (on) { const f = p.querySelector('.gg-sw.on') || p.querySelector('button'); f && f.focus(); }
  }
  doc.addEventListener('pointerdown', e => {
    const p = $('viewPop');
    if (!p.hidden && !p.contains(e.target) && e.target !== $('viewBtn') && e.target !== $('dockView')) toggleView(false);
  });

  // ── credits ──────────────────────────────────────────────────────────────
  function buildCredits() {
    const b = $('creditsBody');
    const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    b.innerHTML = `
      <p>This page shows <a href="${SOURCE.repo}" target="_blank" rel="noopener">CNN Explainer</a> by ${esc(SOURCE.authors)}:
      “${esc(SOURCE.title)}”, ${esc(SOURCE.venue)}.
      <a href="${SOURCE.doi}" target="_blank" rel="noopener">DOI</a> ·
      <a href="${SOURCE.arxiv}" target="_blank" rel="noopener">arXiv</a> ·
      <a href="${SOURCE.live}" target="_blank" rel="noopener">their live demo</a>.</p>
      <h3>What we use</h3>
      <ul>
        <li>Their trained Tiny VGG weights (model/weights.bin), byte for byte, under the MIT licence of the repository (${esc(SOURCE.licence)}). The full notice is in CREDITS.md next to this page.</li>
        <li>Their network design and the ten class names.</li>
      </ul>
      <p>The layout, the drawings, the text and the code are our own. The forward pass is plain JavaScript, not TensorFlow.js. A node check gave the same top class as the original model on all 21 of its example pictures, with probabilities within 1.1 × 10⁻⁶.</p>
      <h3>What we do not use</h3>
      <p>Their example photos are 64 × 64 Tiny ImageNet pictures that the authors do not own, so this page uses its own public-domain and CC0 photos from Wikimedia Commons. We chose photos that the network gets right; it is wrong on many others. Their fonts, icons and interface code are not used.</p>
      <h3>Example photos</h3>
      <div class="cr-photos"></div>
      <p>Your own photo or camera picture stays in your browser.</p>`;
    const grid = b.querySelector('.cr-photos');
    EXAMPLES.forEach((ex, i) => {
      grid.appendChild(thumb(exampleRGB(S.bin, i)));
      const s = doc.createElement('span');
      s.innerHTML = `${esc(ex.cls)} · <a href="${esc(ex.url)}" target="_blank" rel="noopener">${esc(ex.file)}</a> · ${esc(ex.author)} · ${esc(ex.licence)}`;
      grid.appendChild(s);
    });
    $('creditsBtn').addEventListener('click', () => ($('credits').hidden ? openCredits() : closeCredits()));
    $('creditsClose').addEventListener('click', closeCredits);
  }
  function openCredits() { $('credits').hidden = false; $('creditsBtn').setAttribute('aria-expanded', 'true'); $('creditsClose').focus(); }
  function closeCredits() { $('credits').hidden = true; $('creditsBtn').setAttribute('aria-expanded', 'false'); $('creditsBtn').focus(); }

  let toastT = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; win.clearTimeout(toastT); toastT = win.setTimeout(() => { t.hidden = true; }, 3200); }

  // ── go ───────────────────────────────────────────────────────────────────
  relayout();
  runExample(DEFAULT_EXAMPLE);
  S.booted = true;
  // SAVER SEAM: window.snSaver (saver.js) borrows maps, draw and scenes.
  installSaver(page, { doc, win });
  return page;
}

if (typeof window !== 'undefined' && !window.__cnnNoAutoBoot) {
  boot().catch(e => { console.error('cnn-explainer: boot', e); });
}
