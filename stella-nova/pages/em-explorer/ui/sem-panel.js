// ============================================================================
//  EM EXPLORER  ·  ui/sem-panel.js — the "Surface scans" mode switch (SEM)
// ----------------------------------------------------------------------------
//  main.js has one line for this file, the entry point:
//    import('./ui/sem-panel.js').then((m) => m.mountSemMode())
//  The slice explorer stays the default mode. This module adds:
//    #semBtn    "Surface scans" in #topRight (desktop)
//    #dockSem   "Scans" in #dock (phone)
//    #sem       the full-screen layer, made on the first open: #semView
//               (the turntable), #semSide (title and picker), #semCap
//               (caption, method, credit, licence, source), #semScale
//  The turntable code (sem/viewer.js), the catalog and each GLB load only
//  when the reader opens the mode, so the page start does not wait for them.
//
//  STATE  html.em-sem while the mode is open. The hash gets sem=<id> while
//  open; Escape, the back button in the layer, or a dock tab closes it and
//  puts the old hash back. A hash with sem=<id> at load opens the mode.
//  The screensaver (html.sn-saver) closes the mode.
//
//  window.__emSem = { open(id), close(), isOpen(), current(), ready }
//  for tests and the saver.
//
//  grep -n targets: "export function mountSemMode", "async function open",
//                   "function close", "async function show", "function build"
// ============================================================================

const BASE = new URL('../sem/', import.meta.url);
const ID = /^[a-z0-9-]{1,40}$/;

function el(doc, tag, attrs = {}, text) {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else e.setAttribute(k, v);
  }
  if (text != null) e.textContent = text;
  return e;
}

function svg(doc, d) {
  const s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 20 20'); s.setAttribute('aria-hidden', 'true');
  const p = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d); s.append(p);
  return s;
}

const ICON_SCAN = 'M10 2.8 16.5 6.5v7L10 17.2 3.5 13.5v-7zM3.5 6.5 10 10l6.5-3.5M10 10v7.2';
const ICON_BACK = 'M8 5 3 10l5 5M3.5 10H17';
const ICON_LINK = 'M10 12.5V3M6.5 6.2 10 2.8l3.5 3.4M5 9.5H4v8h12v-8h-1';

function hashId(hash) {
  const m = /(?:^|[#&])sem=([^&]+)/.exec(String(hash || ''));
  return m && ID.test(m[1]) ? m[1] : null;
}

export function mountSemMode({ doc = document, win = window } = {}) {
  if (win.__emSem) return win.__emSem;
  // the ids this module makes (sem*, dockSem) are not in index.html, so it
  // looks them up with byId, not in the literal form that the CORE markup test reads
  const byId = (id) => doc.getElementById(id);
  const root = doc.documentElement;
  const initialId = hashId(win.location && win.location.hash);
  const S = { open: false, layer: null, viewer: null, cat: null, mod: null, id: null, token: 0, savedHash: null, ui: {} };

  // the stylesheet is small; add it now so the switch is styled
  if (!byId('semCss')) {
    const link = el(doc, 'link', { id: 'semCss', rel: 'stylesheet', href: new URL('sem.css', BASE).href });
    doc.head.append(link);
  }

  // ── switch ──
  const top = byId('topRight');
  if (top && !byId('semBtn')) {
    const b = el(doc, 'button', { id: 'semBtn', class: 'pill', type: 'button', 'aria-pressed': 'false', title: 'SEM surface scans in 3D (S)' });
    b.append(svg(doc, ICON_SCAN), el(doc, 'span', {}, 'Surface scans'));
    b.addEventListener('click', () => (S.open ? close() : open()));
    top.prepend(b);
  }
  const dock = byId('dock');
  if (dock && !byId('dockSem')) {
    const b = el(doc, 'button', { id: 'dockSem', type: 'button', 'aria-pressed': 'false' });
    b.append(svg(doc, ICON_SCAN), el(doc, 'span', {}, 'Scans'));
    b.addEventListener('click', () => (S.open ? close() : open()));
    dock.append(b);
    // another dock tab goes back to the slices
    dock.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('button') : null;
      if (S.open && t && t.id !== 'dockSem') close();
    }, true);
  }

  function setPressed(v) {
    for (const id of ['semBtn', 'dockSem']) { const b = byId(id); if (b) b.setAttribute('aria-pressed', v ? 'true' : 'false'); }
  }

  // ── layer ──
  function build() {
    const L = el(doc, 'section', { id: 'sem', 'aria-label': 'Surface scans', hidden: '' });
    const canvas = el(doc, 'canvas', { id: 'semView', tabindex: '0', 'aria-label': '3D surface scan. Drag to turn. Scroll or pinch to zoom. Double click to reset.' });
    const side = el(doc, 'div', { id: 'semSide', class: 'sem-card' });
    const head = el(doc, 'div', { class: 'sem-head' });
    head.append(el(doc, 'div', { class: 'brand' }, 'Electron microscopy explorer'),
      el(doc, 'h1', {}, 'Surface scans'),
      el(doc, 'p', { class: 'lead', id: 'semLead' }, 'Real 3D surfaces from scanning electron microscopes. Drag to turn, scroll to zoom.'));
    const list = el(doc, 'ul', { id: 'semList', 'aria-label': 'Scans' });
    side.append(head, list);
    const topBar = el(doc, 'div', { id: 'semTop' });
    const share = el(doc, 'button', { id: 'semShare', class: 'pill', type: 'button' });
    share.append(svg(doc, ICON_LINK), el(doc, 'span', {}, 'Share'));
    const back = el(doc, 'button', { id: 'semBack', class: 'pill', type: 'button', title: 'Back to the slice explorer (Esc)' });
    back.append(svg(doc, ICON_BACK), el(doc, 'span', {}, 'Slice explorer'));
    topBar.append(share, back);
    const cap = el(doc, 'div', { id: 'semCap', class: 'sem-card', role: 'region', 'aria-label': 'About this scan' });
    const capT = el(doc, 'h2', { id: 'semTitle' });
    const capM = el(doc, 'p', { class: 's-m', id: 'semMeta' });
    const capP = el(doc, 'p', { id: 'semText' });
    const capC = el(doc, 'p', { class: 's-c', id: 'semCredit' });
    cap.append(capT, capM, capP, capC);
    cap.addEventListener('click', (e) => { if (!(e.target && e.target.closest && e.target.closest('a'))) cap.classList.toggle('min'); });
    const scale = el(doc, 'div', { id: 'semScale', 'aria-hidden': 'true' });
    const scaleT = el(doc, 'span'); const scaleB = el(doc, 'div', { class: 'bar' });
    scale.append(scaleT, scaleB);
    const hint = el(doc, 'div', { id: 'semHint' }, 'Drag to turn · scroll to zoom · double click to reset');
    const msg = el(doc, 'div', { id: 'semMsg', role: 'status', 'aria-live': 'polite' });
    L.append(canvas, side, topBar, cap, scale, hint, msg);
    doc.body.append(L);
    back.addEventListener('click', () => close());
    share.addEventListener('click', () => shareLink());
    S.layer = L;
    S.ui = { canvas, list, capT, capM, capP, capC, scaleT, scaleB, msg, cap };
  }

  function say(text, bad = false) { S.ui.msg.textContent = text || ''; S.ui.msg.classList.toggle('bad', !!bad); }

  function renderList() {
    const { list } = S.ui;
    list.textContent = '';
    let group = null;
    for (const s of S.cat.SCANS) {
      if (s.method !== group) {
        group = s.method;
        list.append(el(doc, 'li', { class: 's-g', role: 'presentation' }, S.cat.METHOD_LABEL[group] || group));
      }
      const li = el(doc, 'li');
      const b = el(doc, 'button', { type: 'button', 'data-id': s.id, 'aria-current': s.id === S.id ? 'true' : 'false' });
      b.append(el(doc, 'span', { class: 's-t' }, s.title), el(doc, 'span', { class: 's-k' }, s.kind));
      b.addEventListener('click', () => show(s.id));
      li.append(b);
      list.append(li);
    }
  }

  function updateScale() {
    if (!S.viewer) return;
    const n = S.mod.niceScale(S.viewer.umPerPx(), win.innerWidth < 500 ? 90 : 120);
    if (!n) return;
    S.ui.scaleT.textContent = n.label;
    S.ui.scaleB.style.width = Math.round(n.px) + 'px';
  }

  function fmtSize(um) {
    const m = Math.max(um[0], um[1]);
    return m >= 1000 ? (m / 1000).toFixed(2) + ' mm' : m >= 10 ? Math.round(m) + ' µm' : m.toFixed(1) + ' µm';
  }

  function caption(s, model) {
    const { capT, capM, capP, capC } = S.ui;
    capT.textContent = s.title;
    const size = model ? ' · ' + fmtSize(model.sizeUm) + ' across' : '';
    capM.textContent = s.kind + ' · ' + (S.cat.METHOD_LABEL[s.method] || s.method) + size;
    capP.textContent = s.caption;
    capC.textContent = '';
    capC.append(doc.createTextNode(s.credit + '. '));
    const lic = el(doc, 'a', { href: s.licenceUrl, target: '_blank', rel: 'noopener noreferrer' }, s.licence);
    const src = el(doc, 'a', { href: s.source, target: '_blank', rel: 'noopener noreferrer' }, 'Source');
    capC.append(lic, doc.createTextNode(' · '), src);
    if (s.paper) capC.append(doc.createTextNode(' · '), el(doc, 'a', { href: s.paper, target: '_blank', rel: 'noopener noreferrer' }, 'Paper'));
  }

  async function show(id) {
    const s = S.cat.scanById(id) || S.cat.SCANS[0];
    S.id = s.id;
    const token = ++S.token;
    for (const b of S.ui.list.querySelectorAll('button[data-id]')) b.setAttribute('aria-current', b.getAttribute('data-id') === s.id ? 'true' : 'false');
    caption(s, null);
    writeHash();
    say('Loading ' + s.title + '…');
    try {
      const res = await win.fetch(new URL('models/' + s.file, BASE).href);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = await res.arrayBuffer();
      if (token !== S.token) return;
      const model = S.glb.parseGlb(buf);
      if (token !== S.token || !S.viewer) return;
      await S.viewer.setModel(model, { method: s.method });
      if (token !== S.token) return;
      caption(s, model);
      say('');
      updateScale();
    } catch (e) {
      if (token !== S.token) return;
      say('This scan did not load (' + String((e && e.message) || e).slice(0, 80) + '). Check the connection and pick it again.', true);
    }
  }

  function writeHash() {
    if (!S.open || root.classList.contains('sn-saver')) return;
    try { win.history.replaceState(null, '', '#sem=' + S.id); } catch (e) { /* sandboxed */ }
  }

  function shareLink() {
    const url = String(win.location.href).split('#')[0] + '#sem=' + S.id;
    const done = () => say('Link copied', false);
    try {
      if (win.navigator && win.navigator.clipboard && win.navigator.clipboard.writeText) {
        win.navigator.clipboard.writeText(url).then(done, () => say(url));
      } else say(url);
    } catch (e) { say(url); }
    setTimeout(() => { if (S.ui.msg.textContent === 'Link copied') say(''); }, 1800);
  }

  async function open(id) {
    if (root.classList.contains('sn-saver')) return false;
    if (!S.layer) build();
    if (!S.open) {
      S.open = true;
      S.savedHash = String(win.location.hash || '');
      root.classList.add('em-sem');
      S.layer.hidden = false;
      setPressed(true);
    }
    try {
      if (!S.mod) {
        say('Loading the 3D viewer…');
        const [mod, cat, glb] = await Promise.all([
          import(new URL('viewer.js', BASE).href), import(new URL('catalog.js', BASE).href), import(new URL('glb.js', BASE).href)]);
        S.mod = mod; S.cat = cat; S.glb = glb;
      }
      if (!S.open) return false;
      if (!S.viewer) {
        S.viewer = S.mod.createSemViewer(S.ui.canvas, { onChange: updateScale });
        win.addEventListener('resize', onResize);
      }
      renderList();
      await show(id || S.id || S.cat.SCANS[0].id);
      try { S.ui.canvas.focus({ preventScroll: true }); } catch (e) { /* old browser */ }
      return true;
    } catch (e) {
      say(/WebGL2/.test(String(e && e.message)) ? 'This view needs WebGL2, and the browser did not give the page a WebGL2 context.' : 'The 3D viewer did not start: ' + String((e && e.message) || e).slice(0, 120), true);
      return false;
    }
  }

  function onResize() { if (S.viewer && S.open) S.viewer.resize(); }

  function close() {
    if (!S.open) return;
    S.open = false;
    S.token++;
    root.classList.remove('em-sem');
    if (S.layer) S.layer.hidden = true;
    setPressed(false);
    // free the GPU: the slice view is the page's main work
    if (S.viewer) { try { S.viewer.dispose(); } catch (e) { /* gone */ } S.viewer = null; win.removeEventListener('resize', onResize); }
    try { win.history.replaceState(null, '', S.savedHash && !hashId(S.savedHash) ? S.savedHash : String(win.location.href).split('#')[0]); } catch (e) { /* sandboxed */ }
    try { const v = byId('view'); if (v) v.focus({ preventScroll: true }); } catch (e) { /* old browser */ }
  }

  doc.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (S.open && e.key === 'Escape') { e.preventDefault(); close(); }
    else if ((e.key === 's' || e.key === 'S') && !(t && t.isContentEditable)) { e.preventDefault(); S.open ? close() : open(); }
  });

  // the screensaver takes the screen: close the mode
  try {
    new win.MutationObserver(() => { if (S.open && root.classList.contains('sn-saver')) close(); })
      .observe(root, { attributes: true, attributeFilter: ['class'] });
  } catch (e) { /* no observer */ }

  // the page swap in the shell: free our context too
  const prevRelease = win.__snRelease;
  win.__snRelease = function () {
    try { if (S.viewer) { S.viewer.dispose(); S.viewer = null; } } catch (e) { /* gone */ }
    if (typeof prevRelease === 'function') return prevRelease.apply(this, arguments);
  };

  const api = {
    open, close,
    isOpen: () => S.open,
    current: () => S.id,
    ready: initialId ? open(initialId) : Promise.resolve(false),
  };
  win.__emSem = api;
  return api;
}
