// ============================================================================
//  WIKI  ·  pages/wiki/editor.js — editor lock, section editor, publish view
// ────────────────────────────────────────────────────────────────────────────
//  This classic script sets window.SNWikiExt before main.js runs. main.js
//  merges it into its extension points (grep "const EXT" in main.js). The
//  script uses window.SNWiki (set by main.js) only inside event handlers.
//
//  LOCK. The Edit button asks for a password. The script compares the
//  SHA-256 hex of the input with EDIT_HASH and keeps the unlock in
//  sessionStorage for this tab. This is a client-side courtesy lock, not
//  security: anyone can read this file or set the sessionStorage key. Real
//  protection must come from the publish backend (see storage.js).
//
//  EDITOR. One section opens at a time. It has a toolbar, a textarea with
//  [[ wiki link autocomplete, and a live preview from markup.js. Save writes
//  a local draft through SNWikiStorage. The Header panel edits the SCP style
//  Classification and Designation pair. While the open editor has changes,
//  canLeave() is false, and main.js asks before it changes the route.
//
//  grep -n targets
//    var EDIT_HASH        stored password hash
//    function sha256(     crypto.subtle with a JS fallback
//    function askPassword unlock dialog
//    function openEditor  section editor
//    var TOOLS            toolbar actions
//    function autocomplete wiki link autocomplete
//    function openHeader  Classification / Designation panel
//    function entryTools  entry toolbar (publish view, export, publish)
//    function setPublishView
// ============================================================================
(function () {
  'use strict';

  // SHA-256 of the edit password. Only the hash is in the code.
  var EDIT_HASH = '1553cc62ff246044c683a61e203e65541990e7fcd4af9443d22b9557ecc9ac54';
  var UNLOCK_KEY = 'sn-wiki-unlocked';
  var cache = {};          // id -> { draft, published }
  var open = null;         // { kind: 'section'|'header', entry, key, root, orig, value() }
  var W = function () { return window.SNWiki; };
  var S = function () { return window.SNWikiStorage; };

  function isUnlocked() { try { return sessionStorage.getItem(UNLOCK_KEY) === '1'; } catch (e) { return false; } }
  function setUnlocked(on) { try { if (on) sessionStorage.setItem(UNLOCK_KEY, '1'); else sessionStorage.removeItem(UNLOCK_KEY); } catch (e) { /* private mode: unlock lasts until reload */ } paintLock(on); }
  function paintLock(on) {
    var b = document.getElementById('lockBtn');
    if (!b) return;
    b.classList.toggle('unlocked', !!on);
    b.title = on ? 'Editor unlocked. Click to lock.' : 'Editor locked. Click to unlock.';
    b.setAttribute('aria-label', b.title);
    var p = document.getElementById('lockShackle');
    if (p) p.setAttribute('d', on ? 'M8 11V8a4 4 0 0 1 7.5-2' : 'M8 11V8a4 4 0 0 1 8 0v3');
  }

  // ── hashing ──────────────────────────────────────────────────────────────
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function sha256(text) {
    var bytes = new TextEncoder().encode(text);
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      return crypto.subtle.digest('SHA-256', bytes).then(hex).catch(function () { return sha256js(bytes); });
    }
    return Promise.resolve(sha256js(bytes));
  }
  // Small SHA-256 for contexts without crypto.subtle (some file:// pages).
  function sha256js(msg) {
    var K = [], H = [], p = 2, n = 0;
    function frac(x) { return ((x - Math.floor(x)) * 4294967296) >>> 0; }
    while (n < 64) {
      var prime = true;
      for (var d = 2; d * d <= p; d++) if (p % d === 0) { prime = false; break; }
      if (prime) { if (n < 8) H[n] = frac(Math.pow(p, 1 / 2)); K[n] = frac(Math.pow(p, 1 / 3)); n++; }
      p++;
    }
    var l = msg.length, withPad = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(withPad);
    m.set(msg); m[l] = 0x80;
    var bits = l * 8, dv = new DataView(m.buffer);
    dv.setUint32(withPad - 4, bits >>> 0); dv.setUint32(withPad - 8, Math.floor(bits / 4294967296));
    var w = new Array(64);
    for (var o = 0; o < withPad; o += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (i = 16; i < 64; i++) {
        var a = w[i - 15], b = w[i - 2];
        var s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        var s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var A = H[0], B = H[1], C = H[2], Dd = H[3], E = H[4], F = H[5], G = H[6], Hh = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((E >>> 6) | (E << 26)) ^ ((E >>> 11) | (E << 21)) ^ ((E >>> 25) | (E << 7));
        var t1 = (Hh + S1 + ((E & F) ^ (~E & G)) + K[i] + w[i]) | 0;
        var S0 = ((A >>> 2) | (A << 30)) ^ ((A >>> 13) | (A << 19)) ^ ((A >>> 22) | (A << 10));
        var t2 = (S0 + ((A & B) ^ (A & C) ^ (B & C))) | 0;
        Hh = G; G = F; F = E; E = (Dd + t1) | 0; Dd = C; C = B; B = A; A = (t1 + t2) | 0;
      }
      H[0] = (H[0] + A) | 0; H[1] = (H[1] + B) | 0; H[2] = (H[2] + C) | 0; H[3] = (H[3] + Dd) | 0;
      H[4] = (H[4] + E) | 0; H[5] = (H[5] + F) | 0; H[6] = (H[6] + G) | 0; H[7] = (H[7] + Hh) | 0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }

  // ── unlock dialog ────────────────────────────────────────────────────────
  function askPassword() {
    if (isUnlocked()) return Promise.resolve(true);
    var h = W().h;
    return new Promise(function (resolve) {
      var input = h('input', { class: 'field', type: 'password', autocomplete: 'off', 'aria-label': 'Editor password', placeholder: 'Password' });
      var err = h('p', { class: 'ed-err', role: 'alert' });
      var form = h('form', { class: 'ed-modal-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'edLockT' },
        h('p', { class: 'kicker' }, 'Editor lock'),
        h('h2', { id: 'edLockT' }, 'Enter the editor password'),
        h('p', { class: 'dim' }, 'Edits stay on this device as drafts until you publish them.'),
        input, err,
        h('div', { class: 'ed-row' },
          h('button', { class: 'tool-btn', type: 'button', onclick: function () { done(false); } }, 'Cancel'),
          h('button', { class: 'tool-btn primary', type: 'submit' }, 'Unlock')));
      var modal = h('div', { class: 'ed-modal' }, form);
      function done(ok) { modal.remove(); document.removeEventListener('keydown', esc, true); resolve(ok); }
      function esc(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); done(false); } }
      modal.addEventListener('pointerdown', function (ev) { if (ev.target === modal) done(false); });
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        sha256(input.value).then(function (hx) {
          if (hx === EDIT_HASH) { setUnlocked(true); W().toast('Editor unlocked for this tab.'); done(true); }
          else { err.textContent = 'That password is not correct.'; input.select(); }
        });
      });
      document.addEventListener('keydown', esc, true);
      document.body.appendChild(modal);
      setTimeout(function () { input.focus(); }, 30);
    });
  }

  // ── docs ─────────────────────────────────────────────────────────────────
  function current(id) { var c = cache[id]; return c ? (c.draft || c.published) : null; }
  function cloneDoc(id) {
    var d = current(id) || {};
    return { classification: d.classification || '', designation: d.designation || '', sections: Object.assign({}, d.sections || {}) };
  }
  function renderBody(src, e) {
    var w = W();
    return window.SNWikiMarkup.render(src, {
      resolve: function (id) { var x = w.BY[id]; return x ? { name: w.label(x) } : null; },
      sprites: e.sprites, base: '../../'
    });
  }
  function isDirty() {
    if (!open) return false;
    if (!document.body.contains(open.root)) { open = null; return false; }
    return open.value() !== open.orig;
  }
  function closeOpen() { open = null; }
  function rerender(scrollTo) {
    var y = window.scrollY;
    W().render(true);
    window.scrollTo(0, y);
    if (scrollTo) { var t = document.getElementById(scrollTo); if (t) t.scrollIntoView({ block: 'start' }); }
  }
  function save(e, mutate, anchor) {
    var d = cloneDoc(e.id);
    mutate(d);
    return S().saveDraft(e.id, d).then(function (saved) {
      cache[e.id] = cache[e.id] || { draft: null, published: null };
      cache[e.id].draft = saved;
      closeOpen();
      W().toast('Draft saved on this device.');
      rerender(anchor);
    }).catch(function (err) { W().toast(err.message || 'The draft was not saved.'); });
  }
  function guardSwitch() {
    if (!isDirty()) return true;
    if (!window.confirm('Another editor has unsaved changes. Discard them?')) return false;
    return true;
  }

  // ── section editor ───────────────────────────────────────────────────────
  var TOOLS = [
    ['H', 'Heading', function (ta) { line(ta, '== ', ' ==', 'Heading'); }],
    ['B', 'Bold', function (ta) { wrap(ta, '**', '**', 'bold text'); }],
    ['I', 'Italic', function (ta) { wrap(ta, "''", "''", 'italic text'); }],
    ['[[ ]]', 'Wiki link', function (ta, ed) { wrap(ta, '[[', '', ''); ed.ac(); }],
    ['Link', 'External link', function (ta) { wrap(ta, '[https://example.com ', ']', 'label'); }],
    ['❝', 'Block quote', function (ta) { line(ta, '> ', '', 'Quoted text'); }],
    ['•', 'List item', function (ta) { line(ta, '* ', '', 'Item'); }],
    ['███', 'Redaction', function (ta) { wrap(ta, '[[redact|', ']]', 'hidden text'); }],
    ['EXP', '[DATA EXPUNGED] tag', function (ta) { wrap(ta, '[DATA EXPUNGED]', '', ''); }],
    ['▸', 'Collapsible block', function (ta) { block(ta, '[[collapse Title]]\n', '\n[[/collapse]]', 'Hidden text'); }],
    ['fn', 'Footnote', function (ta) { wrap(ta, '[[fn|', ']]', 'footnote text'); }],
    ['—', 'Rule', function (ta) { block(ta, '----', '', ''); }]
  ];
  function insert(ta, text, selFrom, selTo) {
    ta.focus();
    var s = ta.selectionStart, e = ta.selectionEnd;
    var ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (x) { ok = false; }
    if (!ok || ta.value.slice(s, s + text.length) !== text) { ta.setRangeText(text, s, e, 'end'); }
    if (selFrom != null) ta.setSelectionRange(s + selFrom, s + selTo);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function wrap(ta, a, b, ph) {
    var sel = ta.value.slice(ta.selectionStart, ta.selectionEnd) || ph;
    insert(ta, a + sel + b, a.length, a.length + sel.length);
  }
  function line(ta, a, b, ph) {
    var s = ta.selectionStart, pre = ta.value.slice(0, s);
    var nl = pre && !/\n$/.test(pre) ? '\n' : '';
    var sel = ta.value.slice(s, ta.selectionEnd) || ph;
    insert(ta, nl + a + sel + b, nl.length + a.length, nl.length + a.length + sel.length);
  }
  function block(ta, a, b, ph) {
    var s = ta.selectionStart, pre = ta.value.slice(0, s);
    var nl = pre && !/\n\n$/.test(pre) ? (/\n$/.test(pre) ? '\n' : '\n\n') : '';
    var sel = ta.value.slice(s, ta.selectionEnd) || ph;
    insert(ta, nl + a + sel + b + '\n', nl.length + a.length, nl.length + a.length + sel.length);
  }

  function openEditor(e, key, sec) {
    var w = W(), h = w.h;
    if (open && open.kind === 'section' && open.key === key && document.body.contains(open.root)) { open.ta.focus(); return; }
    if (!guardSwitch()) return;
    if (open) { closeOpen(); rerender('sec-' + key); sec = document.getElementById('sec-' + key); }
    var body = sec.querySelector('.sec-body');
    var orig = (cloneDoc(e.id).sections[key]) || '';
    var ta = h('textarea', { class: 'ed-ta', spellcheck: 'true', 'aria-label': 'Section text', rows: '12', placeholder: 'Write this section. Type [[ to link another entry.' });
    ta.value = orig;
    var prev = h('div', { class: 'ed-out' });
    var acList = h('ul', { class: 'ed-ac', role: 'listbox', hidden: true });
    var status = h('span', { class: 'ed-status' });
    var help = h('div', { class: 'ed-help', hidden: true }, helpTable());
    var imgPop = h('div', { class: 'ed-imgs', hidden: true }, e.sprites.map(function (s, i) {
      return h('button', { type: 'button', title: 'Sprite ' + (i + 1), onclick: function () { imgPop.hidden = true; block(ta, '[[image ' + (i + 1) + '|', ']]', 'caption'); } },
        h('img', { src: '../../' + s, alt: '' }), h('span', null, String(i + 1)));
    }));
    var ed = { ac: function () { autocomplete(ta, acList, state); } };
    var bar = h('div', { class: 'ed-bar', role: 'toolbar', 'aria-label': 'Formatting' },
      TOOLS.map(function (t) {
        return h('button', { type: 'button', title: t[1], 'aria-label': t[1], onpointerdown: function (ev) { ev.preventDefault(); }, onclick: function () { t[2](ta, ed); } }, t[0]);
      }),
      h('button', { type: 'button', title: 'Image from this entry', 'aria-label': 'Image from this entry', disabled: e.sprites.length ? null : true,
        onclick: function () { imgPop.hidden = !imgPop.hidden; } }, 'Img'),
      h('span', { class: 'ed-gap' }),
      h('button', { type: 'button', title: 'Markup help', 'aria-label': 'Markup help', onclick: function () { help.hidden = !help.hidden; } }, '?'));
    var state = { items: [], sel: 0, start: 0 };
    var cancel = h('button', { class: 'tool-btn', type: 'button', onclick: function () {
      if (isDirty() && !window.confirm('Discard the changes to this section?')) return;
      closeOpen(); rerender('sec-' + key);
    } }, 'Cancel');
    var saveBtn = h('button', { class: 'tool-btn primary', type: 'button', onclick: function () {
      var v = ta.value;
      save(e, function (d) { if (v.trim()) d.sections[key] = v; else delete d.sections[key]; }, 'sec-' + key);
    } }, 'Save draft');
    var root = h('div', { class: 'ed' }, bar, imgPop, help,
      h('div', { class: 'ed-panes' },
        h('div', { class: 'ed-write' }, ta, acList),
        h('div', { class: 'ed-prev' }, h('p', { class: 'ed-lab' }, 'Preview'), prev)),
      h('div', { class: 'ed-foot' }, status, h('span', { class: 'ed-gap' }), cancel, saveBtn));
    body.textContent = '';
    body.appendChild(root);
    sec.classList.remove('is-empty');
    sec.classList.add('editing');
    open = { kind: 'section', entry: e, key: key, root: root, ta: ta, orig: orig, value: function () { return ta.value; } };

    var t = 0;
    function paint() {
      prev.textContent = '';
      prev.appendChild(ta.value.trim() ? renderBody(ta.value, e) : h('p', { class: 'dim' }, 'Nothing to preview yet.'));
      status.textContent = isDirty() ? 'Unsaved changes' : 'No changes';
      status.classList.toggle('dirty', isDirty());
    }
    ta.addEventListener('input', function () { clearTimeout(t); t = setTimeout(paint, 90); autocomplete(ta, acList, state); });
    ta.addEventListener('click', function () { autocomplete(ta, acList, state); });
    ta.addEventListener('blur', function () { setTimeout(function () { acList.hidden = true; }, 150); });
    ta.addEventListener('keydown', function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') { ev.preventDefault(); saveBtn.click(); return; }
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'b') { ev.preventDefault(); TOOLS[1][2](ta, ed); return; }
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'i') { ev.preventDefault(); TOOLS[2][2](ta, ed); return; }
      if (acList.hidden || !state.items.length) return;
      if (ev.key === 'ArrowDown') { state.sel = (state.sel + 1) % state.items.length; paintAc(acList, state); ev.preventDefault(); }
      else if (ev.key === 'ArrowUp') { state.sel = (state.sel - 1 + state.items.length) % state.items.length; paintAc(acList, state); ev.preventDefault(); }
      else if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); pick(ta, acList, state, state.items[state.sel]); }
      else if (ev.key === 'Escape') { acList.hidden = true; ev.preventDefault(); }
    });
    paint();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  // ── [[ autocomplete ──────────────────────────────────────────────────────
  var KEYWORDS = /^(redact|fn|image|expunged|collapse|\/collapse)\b/;
  function autocomplete(ta, list, state) {
    var w = W(), h = w.h;
    var caret = ta.selectionStart;
    var m = ta.value.slice(0, caret).match(/\[\[([^\[\]|\n]{0,40})$/);
    if (!m || KEYWORDS.test(m[1]) || ta.selectionStart !== ta.selectionEnd) { list.hidden = true; state.items = []; return; }
    var q = m[1].trim().toLowerCase();
    var items;
    if (!q) items = w.ENTRIES.filter(function (x) { return x.category === open.entry.category && x.id !== open.entry.id; }).slice(0, 8);
    else if (q.indexOf('/') >= 0) items = w.ENTRIES.filter(function (x) { return x.id.indexOf(q) === 0; }).slice(0, 8);
    else items = w.search(q).slice(0, 8);
    state.items = items; state.sel = 0; state.start = caret - m[1].length - 2;
    list.textContent = '';
    if (!items.length) { list.hidden = true; return; }
    items.forEach(function (x, i) {
      list.appendChild(h('li', { role: 'option', 'aria-selected': String(i === 0),
        onpointerdown: function (ev) { ev.preventDefault(); },
        onclick: function () { pick(ta, list, state, x); } },
        w.tile(x, 'xs'), h('span', null, w.label(x)), h('small', null, x.id)));
    });
    list.hidden = false;
  }
  function paintAc(list, state) {
    Array.prototype.forEach.call(list.children, function (li, i) { li.setAttribute('aria-selected', String(i === state.sel)); if (i === state.sel) li.scrollIntoView({ block: 'nearest' }); });
  }
  function pick(ta, list, state, x) {
    var w = W();
    var end = ta.selectionStart;
    var after = ta.value.slice(end, end + 2) === ']]' ? 2 : 0;
    ta.setSelectionRange(state.start, end + after);
    insert(ta, '[[' + x.id + '|' + w.label(x) + ']]');
    list.hidden = true; state.items = [];
  }

  function helpTable() {
    var h = W().h;
    var rows = [
      ['== Heading ==', 'Heading (=== for a subheading)'], ['**bold**  \'\'italic\'\'  `code`', 'Text styles'],
      ['[[resources/iron|Iron]]', 'Wiki link. Type [[ to search.'], ['[https://example.com label]', 'External link (http, https, mailto)'],
      ['> text', 'Block quote'], ['* item  /  # item', 'Bullet or numbered list'], ['[[redact|text]]', 'Black bar. Hover or tap shows the text.'],
      ['[DATA EXPUNGED]', 'Expunged tag'], ['[[fn|text]]', 'Footnote'], ['[[image 1|caption]]', 'Sprite from this entry'],
      ['[[collapse Title]] … [[/collapse]]', 'Collapsible block (own lines)'], ['----', 'Rule']
    ];
    return h('table', null, h('tbody', null, rows.map(function (r) { return h('tr', null, h('td', null, h('code', null, r[0])), h('td', null, r[1])); })));
  }

  // ── SCP header pair ──────────────────────────────────────────────────────
  function openHeader(e) {
    var w = W(), h = w.h;
    if (open && open.kind === 'header' && document.body.contains(open.root)) { open.root.querySelector('input').focus(); return; }
    if (!guardSwitch()) return;
    if (open) { closeOpen(); rerender(); }
    var d = cloneDoc(e.id);
    var cls = h('input', { class: 'field', maxlength: '80', placeholder: 'For example: Safe, Euclid, Keter', 'aria-label': 'Classification' });
    var des = h('input', { class: 'field', maxlength: '80', placeholder: 'For example: SN-0042', 'aria-label': 'Designation' });
    cls.value = d.classification; des.value = d.designation;
    var orig = d.designation + '\u0000' + d.classification;
    var root = h('form', { class: 'ed ed-head' },
      h('p', { class: 'ed-lab' }, 'Article header'),
      h('div', { class: 'ed-head-grid' },
        h('label', null, h('span', null, 'Designation'), des),
        h('label', null, h('span', null, 'Classification'), cls)),
      h('div', { class: 'ed-foot' }, h('span', { class: 'ed-gap' }),
        h('button', { class: 'tool-btn', type: 'button', onclick: function () {
          if (isDirty() && !window.confirm('Discard the header changes?')) return;
          closeOpen(); rerender();
        } }, 'Cancel'),
        h('button', { class: 'tool-btn primary', type: 'submit' }, 'Save draft')));
    root.addEventListener('submit', function (ev) {
      ev.preventDefault();
      save(e, function (x) { x.classification = cls.value.trim(); x.designation = des.value.trim(); });
    });
    var art = document.querySelector('.article');
    art.insertBefore(root, art.firstChild);
    open = { kind: 'header', entry: e, root: root, orig: orig, value: function () { return des.value + '\u0000' + cls.value; } };
    des.focus();
  }

  // ── entry toolbar ────────────────────────────────────────────────────────
  function entryTools(e, el) {
    var w = W(), h = w.h;
    var c = cache[e.id] || {};
    var unlocked = isUnlocked();
    w.add(el, h('button', { type: 'button', onclick: function () { setPublishView(true, e); } }, 'Publish view'));
    w.add(el, h('button', { type: 'button', onclick: function () { exportDoc(e); } }, 'Export JSON'));
    if (!unlocked) {
      w.add(el, h('button', { type: 'button', class: 'accent', onclick: function () { askPassword().then(function (ok) { if (ok) rerender(); }); } }, 'Edit'));
      return;
    }
    w.add(el, h('button', { type: 'button', onclick: function () { openHeader(e); } }, 'Header'));
    if (c.draft) {
      w.add(el, h('button', { type: 'button', class: 'accent', onclick: function () { publish(e); } }, 'Publish'));
      w.add(el, h('button', { type: 'button', onclick: function () {
        if (!window.confirm('Delete the local draft of this entry? The published text, if any, stays.')) return;
        S().saveDraft(e.id, null).then(function () { cache[e.id].draft = null; closeOpen(); w.toast('Local draft deleted.'); rerender(); });
      } }, 'Discard draft'));
    }
  }
  function exportDoc(e) {
    var d = current(e.id) || { id: e.id, classification: '', designation: '', sections: {}, updated: null, version: 1 };
    var out = Object.assign({ id: e.id }, d, { entry: { id: e.id, name: e.name, category: e.category } });
    try {
      var blob = new Blob([JSON.stringify(out, null, 2) + '\n'], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = e.id.replace('/', '--') + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      W().toast('Exported ' + a.download);
    } catch (x) { W().toast('Export failed in this browser.'); }
  }
  function publish(e) {
    var w = W(), c = cache[e.id];
    if (!c || !c.draft) return;
    if (isDirty() && !window.confirm('The open editor has unsaved changes. They are not in the published copy. Continue?')) return;
    if (!window.confirm('Publish "' + w.label(e) + '"? The page downloads the JSON and sends it to the site owner.')) return;
    S().publish(e.id, c.draft).then(function (res) {
      if (res.posted) {
        return S().load(e.id).then(function (x) { cache[e.id] = x; closeOpen(); w.toast('Published. The JSON file downloaded too.'); rerender(); });
      }
      w.toast('The send failed (' + res.error + '). The draft stays.' + (res.downloaded ? ' The JSON file downloaded.' : ''));
    });
  }

  // ── publish view ─────────────────────────────────────────────────────────
  function setPublishView(on, e) {
    var w = W(), h = w.h;
    document.body.classList.toggle('publish', !!on);
    var old = document.getElementById('pubBar');
    if (old) old.remove();
    if (on) {
      var bar = h('div', { class: 'pub-bar', id: 'pubBar' },
        h('span', null, 'Publish view'),
        h('button', { class: 'tool-btn', type: 'button', onclick: function () { window.print(); } }, 'Print'),
        h('button', { class: 'tool-btn', type: 'button', onclick: function () { exportDoc(e); } }, 'Export JSON'),
        h('button', { class: 'tool-btn primary', type: 'button', onclick: function () { setPublishView(false); } }, 'Close'));
      document.getElementById('view').prepend(bar);
      window.scrollTo(0, 0);
    }
  }
  window.addEventListener('hashchange', function () { if (!isDirty()) setPublishView(false); });

  // ── extension object for main.js ─────────────────────────────────────────
  window.SNWikiExt = {
    ready: function () {
      paintLock(isUnlocked());
      if (!S()) return Promise.resolve();
      return S().loadAll().then(function (m) { cache = m || {}; });
    },
    doc: current,
    meta: function (id) {
      var c = cache[id];
      if (!c) return null;
      if (c.draft) return { state: 'draft', updated: c.draft.updated };
      if (c.published) return { state: 'published', updated: c.published.updated };
      return null;
    },
    recent: function () {
      return Object.keys(cache).map(function (id) {
        var c = cache[id], d = c.draft || c.published;
        return d ? { id: id, state: c.draft ? 'draft' : 'published', updated: d.updated } : null;
      }).filter(Boolean).sort(function (a, b) { return String(b.updated).localeCompare(String(a.updated)); });
    },
    renderBody: renderBody,
    edit: function (e, key, sec) {
      askPassword().then(function (ok) {
        if (!ok) return;
        // The unlock can change the entry toolbar, so rebuild it first.
        var tools = document.querySelector('.entry-tools');
        if (tools && !isDirty()) { tools.textContent = ''; entryTools(e, tools); }
        openEditor(e, key, document.getElementById('sec-' + key) || sec);
      });
    },
    entryTools: entryTools,
    lock: function () {
      if (isUnlocked()) {
        if (isDirty() && !window.confirm('Lock the editor and discard the unsaved changes?')) return;
        setUnlocked(false); closeOpen(); W().toast('Editor locked.'); rerender();
      } else {
        askPassword().then(function (ok) { if (ok) rerender(); });
      }
    },
    unlocked: isUnlocked,
    canLeave: function () { return !isDirty(); },
    discard: closeOpen
  };
  // Test hook: lets the validation script run the JS fallback hash.
  window.SNWikiEditorTest = { sha256: sha256, sha256js: function (s) { return sha256js(new TextEncoder().encode(s)); } };
})();
