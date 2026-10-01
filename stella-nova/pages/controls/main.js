// ============================================================================
//  CONTROLS  ·  keyboard, readout and action list from the game catalog
// ----------------------------------------------------------------------------
//  Classic script at the end of body. Every binding comes from
//  window.SN_DATA.controls (66 rows in the order of the in-game Controls
//  panel). Each row is { id, label, group, context, chord, chords[] }. A
//  chord is a display string such as 'Ctrl+1', 'Shift+.', 'Up' or
//  'Left click'.
//
//  DATA FLOW
//      SN_DATA.controls ─▶ index()      ─▶ BYKEY: base key -> [binding]
//                                           MODS:  modifier -> [binding]
//      BYKEY ───────────▶ buildBoard()  ─▶ #board, #arrows (bound keys lit)
//      controls ────────▶ buildList()   ─▶ #list (one card per group)
//      key hover / tap / real key press ─▶ showKey() ─▶ #readout
//      #q search + group chips ─▶ applyFilter() ─▶ list rows and key match
//
//  The physical layout below is a plain ANSI board drawn for this page. It
//  is not game data.
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//      group order ........ "var GROUPS"         chip and list order
//      context names ...... "var CTX"            mode badges
//      key layout ......... "var LAYOUT"         rows of [key, width, label]
//      chord parse ........ "function parseChord"
//      key index .......... "function index"
//      keyboard ........... "function buildBoard"
//      key size ........... "function fitBoard"
//      readout ............ "function showKey"
//      action list ........ "function buildList"
//      filter ............. "function applyFilter"
//      real key presses ... "function codeToKey"
//      invert scroll ...... "stnv_invert_scroll"
//      boot ............... "buildChips();"
// ============================================================================
(function () {
  'use strict';

  var CONTROLS = (window.SN_DATA && window.SN_DATA.controls) || [];
  var GROUPS = [];
  CONTROLS.forEach(function (c) { if (GROUPS.indexOf(c.group) === -1) GROUPS.push(c.group); });
  var CTX = { flight: 'Flight mode', redalert: 'Red alert', build: 'Build mode' };
  var MODS = ['Ctrl', 'Cmd', 'Shift'];

  // Rows of [key id, width in key units, cap label]. A null id is a gap.
  var LAYOUT = [
    [['Esc', 1], [null, 0.25], ['F1', 1], ['F2', 1], ['F3', 1], ['F4', 1], [null, 0.25], ['F5', 1], ['F6', 1], ['F7', 1], ['F8', 1], [null, 0.25], ['F9', 1], ['F10', 1], ['F11', 1], ['F12', 1], [null, 0.25], ['Delete', 1, 'Del']],
    [['`', 1], ['1', 1], ['2', 1], ['3', 1], ['4', 1], ['5', 1], ['6', 1], ['7', 1], ['8', 1], ['9', 1], ['0', 1], ['-', 1], ['=', 1], ['Backspace', 2, '\u232b']],
    [['Tab', 1.5], ['Q', 1], ['W', 1], ['E', 1], ['R', 1], ['T', 1], ['Y', 1], ['U', 1], ['I', 1], ['O', 1], ['P', 1], ['[', 1], [']', 1], ['\\', 1.5]],
    [['Caps', 1.75], ['A', 1], ['S', 1], ['D', 1], ['F', 1], ['G', 1], ['H', 1], ['J', 1], ['K', 1], ['L', 1], [';', 1], ["'", 1], ['Enter', 2.25, '\u23ce']],
    [['Shift', 2.25, '\u21e7 Shift'], ['Z', 1], ['X', 1], ['C', 1], ['V', 1], ['B', 1], ['N', 1], ['M', 1], [',', 1], ['.', 1], ['/', 1], ['Shift', 2.75, '\u21e7 Shift']],
    [['Ctrl', 1.5], ['Alt', 1.25], ['Cmd', 1.5, '\u2318 Cmd'], ['Space', 6.5, 'Space'], ['Cmd', 1.5, '\u2318 Cmd'], ['Alt', 1.25], ['Ctrl', 1.5]]
  ];
  var ARROWS = [[[null, 1], ['Up', 1, '\u2191'], [null, 1]], [['Left', 1, '\u2190'], ['Down', 1, '\u2193'], ['Right', 1, '\u2192']]];
  var BOARD_UNITS = 16.5, ARROW_UNITS = 3.7;   // key widths plus gaps (gap = kw / 10)

  var BYKEY = {};   // base key -> [{c, chord, mods}]
  var BYMOD = {};   // modifier -> [{c, chord, mods}]
  var STATE = { q: '', group: 'all', key: null, pinned: false };
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  // ── chord parse ─────────────────────────────────────────────────────────
  // 'Ctrl+Shift+1' -> { mods: ['Ctrl','Shift'], key: '1' }. 'Shift++' is not
  // in the data, so a plain split is safe.
  function parseChord(s) {
    var parts = s.split('+');
    var key = parts.pop();
    return { mods: parts, key: key };
  }

  // ── key index ──────────────────────────────────────────────────────────
  function index() {
    CONTROLS.forEach(function (c) {
      (c.chords || []).forEach(function (ch) {
        var p = parseChord(ch);
        var rec = { c: c, chord: ch, mods: p.mods };
        (BYKEY[p.key] = BYKEY[p.key] || []).push(rec);
        p.mods.forEach(function (m) { (BYMOD[m] = BYMOD[m] || []).push(rec); });
      });
    });
  }
  function bindingsOf(k) { return MODS.indexOf(k) !== -1 ? (BYMOD[k] || []) : (BYKEY[k] || []); }

  // ── chord display ──────────────────────────────────────────────────────
  var CAP = { Up: '\u2191', Down: '\u2193', Left: '\u2190', Right: '\u2192', Cmd: '\u2318', Shift: '\u21e7' };
  function chordNode(ch) {
    var p = parseChord(ch), w = el('span', 'chord');
    p.mods.concat([p.key]).forEach(function (t, i) {
      if (i) w.appendChild(el('span', 'plus', '+'));
      var k = el('kbd', '', CAP[t] || t);
      k.title = t;
      w.appendChild(k);
    });
    return w;
  }
  function chordSet(c) {
    var s = el('span', 'chordset');
    (c.chords || []).forEach(function (ch, i) {
      if (i) s.appendChild(el('span', 'or', 'or'));
      s.appendChild(chordNode(ch));
    });
    return s;
  }

  // ── keyboard ───────────────────────────────────────────────────────────
  // One .key per cap. A bound key takes the colour of its first plain
  // binding (no modifier), or of its first binding when every one has a
  // modifier. A dot marks a key that only works in one mode.
  function keyNode(def) {
    var id = def[0], w = def[1], label = def[2] || id;
    var k = el('div', 'key');
    k.style.setProperty('--w', w);
    if (id === null) { k.classList.add('gap'); return k; }
    k.textContent = label;
    if (label.length > 2) k.classList.add('sm');
    k.dataset.k = id;
    var list = bindingsOf(id);
    if (MODS.indexOf(id) !== -1) {
      if (list.length) { k.classList.add('modk'); k.dataset.g = 'Modifier'; }
    } else if (list.length) {
      var plain = list.filter(function (b) { return !b.mods.length; });
      var lead = (plain[0] || list[0]).c;
      k.classList.add('b');
      k.dataset.g = lead.group;
      if (!plain.length) k.classList.add('mod-only');
      if (list.every(function (b) { return b.c.context; })) k.classList.add('ctx');
    }
    if (list.length) {
      k.tabIndex = 0;
      k.setAttribute('role', 'button');
      k.setAttribute('aria-label', id + ': ' + list.map(function (b) { return b.c.label; }).join(', '));
    }
    return k;
  }
  function buildBoard() {
    [['board', LAYOUT], ['arrows', ARROWS]].forEach(function (pair) {
      var host = $(pair[0]);
      pair[1].forEach(function (row) {
        var r = el('div', 'krow');
        row.forEach(function (def) { r.appendChild(keyNode(def)); });
        host.appendChild(r);
      });
    });
    var wrap = $('kbWrap');
    // Hover previews a key. A click or tap pins it until the next pick.
    wrap.addEventListener('pointerover', function (e) {
      var k = e.target.closest('.key[data-k]');
      if (k && e.pointerType === 'mouse' && !STATE.pinned && bindingsOf(k.dataset.k).length) showKey(k.dataset.k);
    });
    wrap.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && !STATE.pinned) showKey(null); });
    wrap.addEventListener('click', function (e) {
      var k = e.target.closest('.key[data-k]');
      if (!k || !bindingsOf(k.dataset.k).length) return;
      if (STATE.pinned && STATE.key === k.dataset.k) { STATE.pinned = false; showKey(null); return; }
      STATE.pinned = true; showKey(k.dataset.k);
    });
    wrap.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('key')) { e.preventDefault(); e.stopPropagation(); e.target.click(); }
    });
  }

  // Size the keys so the board fits its card. On a phone the arrow cluster
  // sits under the board, so only the board width counts.
  function fitBoard() {
    var wrap = $('kbWrap'), card = wrap.parentNode;
    var cs = getComputedStyle(card);
    var avail = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var stacked = getComputedStyle(wrap).flexDirection === 'column';
    // A wide card keeps the readout in a 300px column to the right.
    if (getComputedStyle(card).gridTemplateColumns.split(' ').length > 1) avail -= 300 + parseFloat(cs.columnGap || 24);
    var units = stacked ? BOARD_UNITS : BOARD_UNITS + ARROW_UNITS;
    var kw = Math.max(18, Math.min(52, Math.floor((avail - 4) / units)));
    document.documentElement.style.setProperty('--kw', kw + 'px');
    document.documentElement.style.setProperty('--kg', Math.max(2, Math.round(kw * 0.1)) + 'px');
  }

  // ── readout ────────────────────────────────────────────────────────────
  // List every binding of key k, or show the legend when k is null.
  function showKey(k) {
    STATE.key = k;
    document.querySelectorAll('.key.hot').forEach(function (n) { n.classList.remove('hot'); });
    var ro = $('readout');
    ro.textContent = '';
    if (!k) { ro.appendChild(legend()); return; }
    document.querySelectorAll('.key[data-k="' + cssEsc(k) + '"]').forEach(function (n) { n.classList.add('hot'); });
    var head = el('div', 'ro-key');
    head.appendChild(el('kbd', '', CAP[k] ? CAP[k] + ' ' + k : k));
    var list = bindingsOf(k);
    head.appendChild(el('span', 'n', list.length + (list.length === 1 ? ' binding' : ' bindings')));
    ro.appendChild(head);
    var ul = el('ul', 'ro-list');
    list.forEach(function (b) {
      var li = el('li'); li.dataset.g = b.c.group;
      li.appendChild(chordNode(b.chord));
      li.appendChild(el('span', 'lbl', b.c.label));
      var meta = el('span', 'meta', b.c.group);
      if (b.c.context) meta.appendChild(el('span', 'ctxb', CTX[b.c.context] || b.c.context));
      li.appendChild(meta);
      ul.appendChild(li);
    });
    ro.appendChild(ul);
  }
  function legend() {
    var d = el('div', 'ro-hint');
    d.appendChild(el('p', '', 'Hover or tap a lit key. Press a key on your own keyboard to find it here.'));
    var lg = el('div', 'legend');
    GROUPS.forEach(function (g) {
      if (g === 'Pointer') return;
      var s = el('span'); s.dataset.g = g; s.appendChild(el('i')); s.appendChild(document.createTextNode(g)); lg.appendChild(s);
    });
    var c = el('span'); var i = el('i', 'ctxdot'); c.appendChild(i); c.appendChild(document.createTextNode('One mode only')); lg.appendChild(c);
    d.appendChild(lg);
    return d;
  }
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'); }

  // ── action list ────────────────────────────────────────────────────────
  // One card per group in panel order, one button row per binding. A row
  // lights its keys and shows the first key in the readout.
  function buildList() {
    var host = $('list');
    GROUPS.forEach(function (g) {
      var card = el('div', 'grp'); card.dataset.g = g;
      var h = el('h2', '', g); var cnt = el('span', 'c'); h.appendChild(cnt); card.appendChild(h);
      CONTROLS.filter(function (c) { return c.group === g; }).forEach(function (c) {
        var row = el('button', 'row'); row.type = 'button';
        row.dataset.id = c.id; row.dataset.g = c.group;
        row.dataset.text = (c.label + ' ' + c.group + ' ' + (c.chords || []).join(' ') + ' ' + (CTX[c.context] || '')).toLowerCase();
        var l = el('span', 'l'); l.appendChild(el('span', 't', c.label));
        if (c.context) l.appendChild(el('span', 'ctxb', CTX[c.context] || c.context));
        row.appendChild(l);
        row.appendChild(chordSet(c));
        row.addEventListener('click', function () { pickRow(row, c); });
        card.appendChild(row);
      });
      host.appendChild(card);
    });
    $('listNote').textContent = CONTROLS.length + ' bindings';
  }
  function pickRow(row, c) {
    document.querySelectorAll('.row.sel').forEach(function (r) { r.classList.remove('sel'); });
    row.classList.add('sel');
    var first = c.chords && c.chords[0] ? parseChord(c.chords[0]).key : null;
    if (first && document.querySelector('.key[data-k="' + cssEsc(first) + '"]')) {
      STATE.pinned = true; showKey(first);
      var kb = $('sec-keys').getBoundingClientRect();
      if (kb.bottom < 80 || kb.top > window.innerHeight) $('sec-keys').scrollIntoView({ block: 'start' });
    }
  }

  // ── filter ─────────────────────────────────────────────────────────────
  // The search text and the group chip both narrow the list. Keys of the
  // rows that remain get .match; the board dims the rest while a filter is on.
  function applyFilter() {
    var q = STATE.q.trim().toLowerCase(), g = STATE.group, shown = 0, keys = {};
    document.querySelectorAll('.grp').forEach(function (card) {
      var n = 0;
      card.querySelectorAll('.row').forEach(function (row) {
        var ok = (g === 'all' || row.dataset.g === g) && (!q || row.dataset.text.indexOf(q) !== -1 || keyMatch(row, q));
        row.hidden = !ok;
        if (ok) {
          n++;
          var c = byId[row.dataset.id];
          (c.chords || []).forEach(function (ch) { var p = parseChord(ch); keys[p.key] = 1; p.mods.forEach(function (m) { keys[m] = 1; }); });
        }
      });
      card.hidden = n === 0;
      card.querySelector('h2 .c').textContent = n;
      shown += n;
    });
    $('empty').hidden = shown !== 0;
    var on = !!q || g !== 'all';
    $('board').classList.toggle('filtering', on);
    $('arrows').classList.toggle('filtering', on);
    document.querySelectorAll('.key[data-k]').forEach(function (k) { k.classList.toggle('match', !!keys[k.dataset.k]); });
    $('keyNote').textContent = on ? Object.keys(keys).length + ' keys match' : Object.keys(BYKEY).filter(function (k) { return !/click$/.test(k); }).length + ' bound keys';
  }
  // A one- or two-character query also matches a key cap exactly ('r', '.').
  function keyMatch(row, q) {
    if (q.length > 2) return false;
    var c = byId[row.dataset.id];
    return (c.chords || []).some(function (ch) { return parseChord(ch).key.toLowerCase() === q; });
  }
  var byId = {};
  CONTROLS.forEach(function (c) { byId[c.id] = c; });

  function buildChips() {
    var host = $('chips');
    ['all'].concat(GROUPS).forEach(function (g) {
      var b = el('button', 'gchip', g === 'all' ? 'All' : g);
      b.type = 'button'; b.dataset.g = g;
      b.setAttribute('aria-pressed', g === 'all' ? 'true' : 'false');
      b.addEventListener('click', function () {
        STATE.group = (STATE.group === g && g !== 'all') ? 'all' : g;
        host.querySelectorAll('.gchip').forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.g === STATE.group ? 'true' : 'false'); });
        applyFilter();
      });
      host.appendChild(b);
    });
    $('q').addEventListener('input', function (e) { STATE.q = e.target.value; applyFilter(); });
  }

  // The catalog Pointer rows go first in the mouse section, with the usual
  // trackpad gesture for each button.
  function buildMouse() {
    var host = $('mouseRows'), first = host.firstChild;
    var PAD = { 'Left click': 'Trackpad: click', 'Right click': 'Trackpad: two-finger click' };
    var KEYCAP = { 'Left click': 'Left', 'Right click': 'Right' };
    var COL = { 'Left click': '#96c8ff', 'Right click': '#ffc832' };
    CONTROLS.filter(function (c) { return c.group === 'Pointer'; }).forEach(function (c) {
      var ch = c.chords[0];
      var r = el('div', 'm-row'); r.style.setProperty('--mc', COL[ch] || '#96c8ff');
      r.appendChild(el('span', 'm-k', KEYCAP[ch] || ch));
      r.appendChild(el('span', 'm-v', c.label));
      r.appendChild(el('span', 'm-t', PAD[ch] || ch));
      host.insertBefore(r, first);
    });
  }

  // ── real key presses ───────────────────────────────────────────────────
  // Map KeyboardEvent.code to a key id of the board. Nothing is blocked, so
  // the browser keeps its own shortcuts.
  var CODE = { Backquote: '`', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Period: '.', Comma: ',', Minus: '-', Equal: '=', Semicolon: ';', Quote: "'", Slash: '/', Space: 'Space', Tab: 'Tab', Delete: 'Delete', Backspace: 'Backspace', Enter: 'Enter', Escape: 'Esc', CapsLock: 'Caps', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', MetaLeft: 'Cmd', MetaRight: 'Cmd', AltLeft: 'Alt', AltRight: 'Alt' };
  function codeToKey(code) {
    if (CODE[code]) return CODE[code];
    var m = /^Key([A-Z])$/.exec(code) || /^Digit([0-9])$/.exec(code) || /^(F[0-9]{1,2})$/.exec(code);
    return m ? m[1] : null;
  }
  window.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    var k = codeToKey(e.code);
    if (!k) return;
    if (k === 'Space' && t === document.body) e.preventDefault();
    document.querySelectorAll('.key[data-k="' + cssEsc(k) + '"]').forEach(function (n) { n.classList.add('down'); });
    if (bindingsOf(k).length) { STATE.pinned = true; showKey(k); }
  });
  window.addEventListener('keyup', function (e) {
    var k = codeToKey(e.code);
    if (k) document.querySelectorAll('.key[data-k="' + cssEsc(k) + '"]').forEach(function (n) { n.classList.remove('down'); });
  });

  // ── invert scroll ──────────────────────────────────────────────────────
  // Restore the stored choice and write it back on change. Storage can be
  // off (private mode, file://), so both sides are guarded.
  (function () {
    var cb = $('invertScroll');
    try { cb.checked = localStorage.getItem('stnv_invert_scroll') === '1'; } catch (e) { /* storage off */ }
    cb.addEventListener('change', function () {
      try { localStorage.setItem('stnv_invert_scroll', cb.checked ? '1' : '0'); } catch (e) { /* storage off */ }
    });
  })();

  // ── boot ───────────────────────────────────────────────────────────────
  index();
  buildChips();
  buildBoard();
  buildList();
  buildMouse();
  fitBoard();
  showKey(null);
  applyFilter();
  window.addEventListener('resize', fitBoard);
  if (!CONTROLS.length) $('empty').hidden = false;
})();
