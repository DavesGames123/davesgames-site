// ============================================================================
//  TRANSLATION TOOL  ·  pages/translate/main.js — crowd translation editor
// ----------------------------------------------------------------------------
//  Classic script. strings/en.js gives the English source (SN_TR.keys and
//  SN_TR.en, parallel arrays) and the language list (SN_TR.langs). When the
//  translator picks a language, this script loads strings/<code>.js, which
//  gives the text that the game ships for that language (SN_TR.game[code]).
//
//  A row has three layers:
//    English source  ─▶  shipped game text (may be absent)  ─▶  your edit
//  Your edits live in localStorage under "sn_tr_v5" as
//    { <code>: { <key>: { v: <your text>, s: <English text when saved> } } }
//  The s field drives the "Changed" filter: the English text moved after you
//  saved the edit. Edits from the old page ("sn_tr_v4") migrate on load.
//  The old store stays in place, so a rollback of the page loses nothing.
//
//  ROW STATUS
//    mine     you have an edit and the English text did not change
//    changed  you have an edit and the English text changed since then
//    game     no edit, the game ships a translation
//    todo     no edit, and no shipped translation (or it equals English)
//
//  GREP TARGETS  (grep -n "<target>" main.js)
//    storage keys ........ "var SK5"
//    migration ........... "function migrateV4"
//    language load ....... "function loadLang"
//    key classes ......... "function catOf"
//    row status .......... "function statusOf"
//    picker render ....... "function renderLangs"
//    toolbar render ...... "function renderTools"
//    progress ............ "function renderProg"
//    rows render ......... "function renderRows"
//    one row ............. "function rowHtml"
//    save one key ........ "function commit"
//    keyboard flow ....... "function onKey"
//    TOML export ......... "function exportToml"
//    TOML import ......... "function parseToml"
//    submit one key ...... "function submitKey"
//    boot ................ "function boot"
// ============================================================================
(function () {
  'use strict';

  var T = window.SN_TR;
  var $ = function (id) { return document.getElementById(id); };
  if (!T || !T.keys) {
    $('langs').innerHTML = '<div class="empty">The string table did not load.</div>';
    return;
  }
  var KEYS = T.keys, EN = T.en, N = KEYS.length;
  var IDX = {};
  KEYS.forEach(function (k, i) { IDX[k] = i; });
  var LANG = {};
  T.langs.forEach(function (l) { LANG[l.code] = l; });
  var CHANGED_V4 = {};
  (T.changedSinceV4 || []).forEach(function (k) { CHANGED_V4[k] = true; });

  var SK5 = 'sn_tr_v5', SK4 = 'sn_tr_v4', SKUI = 'sn_tr_ui';
  // Form endpoint that emails one submitted translation to the author.
  var BACKEND_URL = 'https://formsubmit.co/ajax/dave@davesgames.io';
  var PAGE = 40;

  var CATS = [
    { id: 'ux', label: 'Interface' },
    { id: 'title', label: 'Title sequence' },
    { id: 'tutorial', label: 'Tutorial' },
    { id: 'narrative', label: 'Narratives' }
  ];
  var STATUS = [
    { id: 'all', label: 'All' },
    { id: 'todo', label: 'Untranslated' },
    { id: 'changed', label: 'Changed' },
    { id: 'mine', label: 'My edits' }
  ];

  var tr = {};
  var st = { lang: null, cat: 'ux', sec: 'all', status: 'all', q: '', shown: PAGE };
  var loading = {};

  // ── storage ──────────────────────────────────────────────────────────────
  function readJSON(k) { try { var s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function save() { try { localStorage.setItem(SK5, JSON.stringify(tr)); } catch (e) { toast('Browser storage is full or blocked'); } }
  function saveUi() { try { localStorage.setItem(SKUI, JSON.stringify({ lang: st.lang, cat: st.cat })); } catch (e) {} }

  // The v4 store kept { code: { key: text } }. Each text becomes an edit.
  // The source stamp is the current English text, unless the English text
  // changed after the v4 page shipped: then the stamp is null and the row
  // shows as Changed.
  function migrateV4() {
    var old = readJSON(SK4);
    if (!old) return;
    Object.keys(old).forEach(function (code) {
      if (!LANG[code] || !old[code]) return;
      Object.keys(old[code]).forEach(function (key) {
        var v = old[code][key];
        if (IDX[key] === undefined || !v) return;
        tr[code] = tr[code] || {};
        if (!tr[code][key]) tr[code][key] = { v: v, s: CHANGED_V4[key] ? null : EN[IDX[key]] };
      });
    });
    save();
  }

  // ── language data ────────────────────────────────────────────────────────
  function loadLang(code, done) {
    if (code === 'en' || (T.game && T.game[code])) { done(); return; }
    if (loading[code]) { loading[code].push(done); return; }
    loading[code] = [done];
    var s = document.createElement('script');
    s.src = 'strings/' + encodeURIComponent(code) + '.js';
    s.onload = function () {
      pruneSame(code);
      var cbs = loading[code]; delete loading[code];
      cbs.forEach(function (f) { f(); });
    };
    s.onerror = function () {
      var cbs = loading[code]; delete loading[code];
      toast('Could not load the shipped ' + LANG[code].english + ' strings');
      cbs.forEach(function (f) { f(); });
    };
    document.head.appendChild(s);
  }

  // An edit that equals the shipped text adds nothing. The v4 page seeded
  // shipped text into the store, so this removes those copies.
  function pruneSame(code) {
    var g = T.game && T.game[code], m = tr[code];
    if (!g || !m) return;
    var n = 0;
    Object.keys(m).forEach(function (k) {
      if (g[IDX[k]] && m[k].v === g[IDX[k]] && m[k].s !== null) { delete m[k]; n++; }
    });
    if (n) save();
  }

  // ── key classes ──────────────────────────────────────────────────────────
  function catOf(k) {
    var h = k.slice(0, k.indexOf('.'));
    return h === 'title' || h === 'tutorial' || h === 'narrative' ? h : 'ux';
  }
  function secOf(k) {
    var p = k.split('.');
    return catOf(k) === 'ux' ? p[0] : p.slice(0, 2).join('.');
  }
  function secLabel(s) {
    var p = s.split('.');
    var t = (p.length > 1 ? p[1] : p[0]).replace(/_/g, ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function mineOf(k) { return st.lang && tr[st.lang] ? tr[st.lang][k] : null; }
  function gameOf(i) {
    if (!st.lang || st.lang === 'en') return null;
    var g = T.game && T.game[st.lang];
    var v = g ? g[i] : null;
    return v && v !== EN[i] ? v : null;
  }
  function statusOf(i) {
    var m = mineOf(KEYS[i]);
    if (m) return m.s === EN[i] ? 'mine' : 'changed';
    return gameOf(i) ? 'game' : 'todo';
  }

  // ── text helpers ─────────────────────────────────────────────────────────
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function marks(s) {
    return esc(s)
      .replace(/\{([^}]+)\}/g, '<span class="ph">{$1}</span>')
      .replace(/\[([a-z]+):([^\]]+)\]/g, '<span class="mk">[$1:$2]</span>')
      .replace(/\n/g, '<span class="nl">↵</span><br>');
  }
  function tokens(s) { return (s.match(/\{[^}]+\}/g) || []).concat(s.match(/\[[a-z]+:[^\]]+\]/g) || []); }
  function missingTokens(src, v) {
    return tokens(src).filter(function (t) { return v.indexOf(t) < 0; });
  }
  function pct(n, d) { return d ? Math.round(n / d * 100) : 0; }
  function mineCount(code) { return tr[code] ? Object.keys(tr[code]).length : 0; }

  // ── language picker ──────────────────────────────────────────────────────
  function renderLangs() {
    var box = $('langs');
    box.classList.toggle('compact', !!st.lang);
    var h = st.lang ? '' : '<div class="sec-head"><span class="kicker">Languages</span><span class="sec-note">' + T.langs.length + ' in the game</span></div>';
    h += '<div class="lang-grid">';
    T.langs.forEach(function (l) {
      var game = l.code === 'en' ? N : (l.gameDone || 0);
      var mine = mineCount(l.code);
      var on = st.lang === l.code;
      h += '<button class="lang' + (on ? ' on' : '') + '" type="button" data-lang="' + esc(l.code) + '" title="' + esc(l.english + (l.mode ? ' (' + l.mode + ')' : '')) + '">' +
        '<span class="flag" aria-hidden="true">' + l.flag + '</span>' +
        '<span class="l-txt"><span class="l-name">' + esc(l.name) + '</span>' +
        '<span class="l-sub">' + esc(l.english) + (l.mode ? ' · ' + esc(l.mode) : '') + '</span></span>' +
        '<span class="l-code">' + esc(l.code) + '</span>' +
        '<span class="l-bar" aria-hidden="true"><i style="width:' + pct(game, N) + '%"></i></span>' +
        '<span class="l-stat">' + (l.code === 'en' ? 'Source text' : pct(game, N) + '% in game') +
        (mine ? ' · <b>' + mine + ' yours</b>' : '') + '</span></button>';
    });
    h += '</div>';
    box.innerHTML = h;
    var on = box.querySelector('.lang.on');
    if (on && on.scrollIntoView && box.classList.contains('compact')) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function pickLang(code) {
    st.lang = code; st.sec = 'all'; st.shown = PAGE;
    saveUi();
    renderLangs();
    $('intro').hidden = true;
    $('work').hidden = false;
    $('dock').hidden = false;
    document.body.classList.add('has-dock');
    $('rows').innerHTML = '<div class="empty">Loading ' + esc(LANG[code].english) + '…</div>';
    loadLang(code, function () {
      if (st.lang !== code) return;
      renderLangs(); renderTools(); renderRows(); renderProg();
    });
  }

  // ── toolbar ──────────────────────────────────────────────────────────────
  function catKeys(cat) {
    var out = [];
    for (var i = 0; i < N; i++) if (catOf(KEYS[i]) === cat) out.push(i);
    return out;
  }
  function renderTools() {
    var h = '<div class="cats" role="tablist">';
    CATS.forEach(function (c) {
      var ids = catKeys(c.id), done = 0;
      ids.forEach(function (i) { if (statusOf(i) !== 'todo') done++; });
      h += '<button class="cat' + (st.cat === c.id ? ' on' : '') + '" type="button" role="tab" data-cat="' + c.id + '">' +
        esc(c.label) + '<span class="ct">' + done + '/' + ids.length + '</span></button>';
    });
    h += '</div><div class="filters"><label class="sel"><span>Section</span><select id="secSel"><option value="all">All sections</option>';
    var secs = {};
    catKeys(st.cat).forEach(function (i) { var s = secOf(KEYS[i]); secs[s] = (secs[s] || 0) + 1; });
    Object.keys(secs).sort().forEach(function (s) {
      h += '<option value="' + esc(s) + '"' + (st.sec === s ? ' selected' : '') + '>' + esc(secLabel(s)) + ' (' + secs[s] + ')</option>';
    });
    h += '</select></label><div class="seg" role="group" aria-label="Status filter">';
    STATUS.forEach(function (f) {
      h += '<button type="button" class="' + (st.status === f.id ? 'on' : '') + '" data-status="' + f.id + '">' + f.label + '</button>';
    });
    h += '</div><label class="find"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>' +
      '<input id="q" type="search" placeholder="Search keys and text" value="' + esc(st.q) + '" autocomplete="off" spellcheck="false" aria-label="Search">' +
      '<kbd>/</kbd></label></div>';
    $('tools').innerHTML = h;
    var on = $('tools').querySelector('.cat.on'), bar = on && on.parentNode;
    if (on && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = on.offsetLeft - (bar.clientWidth - on.offsetWidth) / 2;
  }

  function renderProg() {
    var ids = catKeys(st.cat), c = { mine: 0, changed: 0, game: 0, todo: 0 };
    ids.forEach(function (i) { c[statusOf(i)]++; });
    var n = ids.length || 1;
    var l = LANG[st.lang];
    $('prog').innerHTML =
      '<div class="bar"><i class="b-game" style="width:' + (c.game / n * 100) + '%"></i><i class="b-mine" style="width:' + ((c.mine + c.changed) / n * 100) + '%"></i></div>' +
      '<div class="legend"><span><i class="d-game"></i>In game <b>' + c.game + '</b></span>' +
      '<span><i class="d-mine"></i>Yours <b>' + (c.mine + c.changed) + '</b></span>' +
      (c.changed ? '<span><i class="d-chg"></i>Changed <b>' + c.changed + '</b></span>' : '') +
      '<span><i class="d-todo"></i>Untranslated <b>' + c.todo + '</b></span>' +
      '<span class="pc">' + pct(ids.length - c.todo, ids.length) + '%</span></div>';
    $('dockInfo').innerHTML = '<span class="flag">' + l.flag + '</span><span><b>' + esc(l.english) + '</b>' +
      (l.mode ? ' <span class="mode">' + esc(l.mode) + '</span>' : '') + '<br><small>' + mineCount(st.lang) + ' edits saved in this browser</small></span>';
  }

  // ── rows ─────────────────────────────────────────────────────────────────
  function visible() {
    var q = st.q.trim().toLowerCase(), out = [];
    for (var i = 0; i < N; i++) {
      var k = KEYS[i];
      if (catOf(k) !== st.cat) continue;
      if (st.sec !== 'all' && secOf(k) !== st.sec) continue;
      var s = statusOf(i);
      if (st.status === 'todo' && s !== 'todo') continue;
      if (st.status === 'changed' && s !== 'changed') continue;
      if (st.status === 'mine' && s !== 'mine' && s !== 'changed') continue;
      if (q) {
        var m = mineOf(k), g = gameOf(i);
        if (k.toLowerCase().indexOf(q) < 0 && EN[i].toLowerCase().indexOf(q) < 0 &&
          !(g && g.toLowerCase().indexOf(q) >= 0) && !(m && m.v.toLowerCase().indexOf(q) >= 0)) continue;
      }
      out.push(i);
    }
    return out;
  }

  function rowHtml(i) {
    var k = KEYS[i], m = mineOf(k), g = gameOf(i), s = statusOf(i);
    var v = m ? m.v : '';
    var miss = v ? missingTokens(EN[i], v) : [];
    var h = '<article class="row st-' + s + '" data-i="' + i + '">' +
      '<header class="r-head"><span class="dot" aria-hidden="true"></span><code class="key">' + esc(k) + '</code>' +
      (tokens(EN[i]).length ? '<span class="badge">tokens</span>' : '') +
      (s === 'changed' ? '<span class="badge chg">English changed</span>' : '') + '</header>' +
      '<div class="src" lang="en">' + marks(EN[i]) + '</div>';
    if (g) {
      h += '<div class="game"><span class="g-lab">In game</span><span class="g-txt">' + marks(g) + '</span>' +
        '<button class="mini" type="button" data-act="use">Edit this</button></div>';
    }
    h += '<textarea class="ti" rows="1" data-key="' + esc(k) + '" lang="' + esc(st.lang) + '" placeholder="' +
      (g ? 'Keep the game text, or type a better line' : 'Type the ' + esc(LANG[st.lang].english) + ' text') + '">' + esc(v) + '</textarea>' +
      '<div class="r-foot"><span class="warn">' + (miss.length ? 'Missing ' + esc(miss.join(' ')) : '') + '</span>' +
      (s === 'changed' ? '<button class="mini" type="button" data-act="keep" title="The new English text needs no change to your line">Keep mine</button>' : '') +
      (m ? '<button class="mini" type="button" data-act="clear">Clear</button>' : '') +
      '<button class="mini send" type="button" data-act="submit"' + (m ? '' : ' disabled') + '>Submit</button></div></article>';
    return h;
  }

  function renderRows(keepScroll) {
    var ids = visible(), list = ids.slice(0, st.shown);
    var h = '', last = null;
    list.forEach(function (i) {
      var s = secOf(KEYS[i]);
      if (s !== last) { h += '<div class="sh"><span>' + esc(secLabel(s)) + '</span><code>' + esc(s) + '</code></div>'; last = s; }
      h += rowHtml(i);
    });
    if (!ids.length) h = '<div class="empty">No lines match these filters.</div>';
    else if (list.length < ids.length) h += '<button class="more" type="button" id="more">Show more · ' + (ids.length - list.length) + ' left</button>';
    var y = window.scrollY;
    $('rows').innerHTML = h;
    Array.prototype.forEach.call($('rows').querySelectorAll('.ti'), grow);
    if (keepScroll) window.scrollTo(0, y);
    watchMore();
  }

  var io = null;
  function watchMore() {
    if (io) io.disconnect();
    var m = $('more');
    if (!m || !window.IntersectionObserver) return;
    io = new IntersectionObserver(function (es) {
      if (es[0].isIntersecting) { st.shown += PAGE; renderRows(true); }
    }, { rootMargin: '600px' });
    io.observe(m);
  }

  function grow(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 320) + 'px'; }

  // Replace one row in place after a change, so focus and scroll stay put.
  function refreshRow(i) {
    var old = $('rows').querySelector('.row[data-i="' + i + '"]');
    if (!old) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = rowHtml(i);
    var n = tmp.firstChild;
    old.parentNode.replaceChild(n, old);
    grow(n.querySelector('.ti'));
    return n;
  }

  // ── save one key ─────────────────────────────────────────────────────────
  function commit(t) {
    var k = t.dataset.key, i = IDX[k], v = t.value.replace(/\s+$/, '');
    var m = mineOf(k), g = gameOf(i);
    if (!st.lang) return false;
    tr[st.lang] = tr[st.lang] || {};
    if (!v || v === g || (st.lang === 'en' && v === EN[i])) {
      if (!m) return false;
      delete tr[st.lang][k];
    } else {
      if (m && m.v === v) return false;
      tr[st.lang][k] = { v: v, s: EN[i] };
    }
    save();
    renderProg();
    return true;
  }

  function rowOf(el) { return el.closest('.row'); }
  function focusRow(row, dir) {
    var n = dir > 0 ? row.nextElementSibling : row.previousElementSibling;
    while (n && !n.classList.contains('row')) {
      if (n.id === 'more') { st.shown += PAGE; var idx = row.dataset.i; renderRows(true); row = $('rows').querySelector('.row[data-i="' + idx + '"]'); n = row.nextElementSibling; continue; }
      n = dir > 0 ? n.nextElementSibling : n.previousElementSibling;
    }
    if (!n) return;
    var t = n.querySelector('.ti');
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
    n.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // ── keyboard flow ────────────────────────────────────────────────────────
  function onKey(ev) {
    var t = ev.target;
    if (t.classList && t.classList.contains('ti')) {
      if (ev.isComposing || ev.keyCode === 229) return;
      var row = rowOf(t);
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        if (commit(t)) row = refreshRow(+row.dataset.i);
        submitKey(KEYS[+row.dataset.i], row.querySelector('[data-act="submit"]'));
      } else if (ev.key === 'Enter' && !ev.shiftKey && !ev.altKey) {
        ev.preventDefault();
        if (commit(t)) row = refreshRow(+row.dataset.i);
        focusRow(row, 1);
      } else if (ev.altKey && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        ev.preventDefault();
        if (commit(t)) row = refreshRow(+row.dataset.i);
        focusRow(row, ev.key === 'ArrowDown' ? 1 : -1);
      } else if (ev.key === 'Escape') {
        var m = mineOf(t.dataset.key);
        t.value = m ? m.v : '';
        grow(t);
        t.blur();
      }
      return;
    }
    var typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
    if (ev.key === '/' && !typing && $('q')) { ev.preventDefault(); $('q').focus(); }
    if (ev.key === 'Escape' && ev.target.id === 'q') { ev.target.blur(); }
  }

  // ── TOML ─────────────────────────────────────────────────────────────────
  function tomlStr(v) {
    return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
  }
  function exportToml() {
    var m = tr[st.lang] || {}, l = LANG[st.lang];
    var keys = Object.keys(m).filter(function (k) { return IDX[k] !== undefined; }).sort();
    if (!keys.length) { toast('No edits to export yet'); return; }
    var t = '# Stella Nova: ' + l.english + (l.mode ? ' (' + l.mode + ')' : '') + '\n' +
      '# Edits from the Translation Tool, ' + new Date().toISOString().slice(0, 10) + '\n' +
      '# Only the lines you changed are here. The game keeps its own text for the rest.\n\n';
    var tables = {};
    keys.forEach(function (k) {
      var p = k.split('.'), tbl = p.slice(0, -1).join('.');
      (tables[tbl] = tables[tbl] || []).push([p[p.length - 1], m[k].v]);
    });
    Object.keys(tables).sort().forEach(function (tbl) {
      t += '[' + tbl + ']\n';
      var w = Math.max.apply(null, tables[tbl].map(function (r) { return r[0].length; }));
      tables[tbl].forEach(function (r) { t += r[0] + new Array(w - r[0].length + 2).join(' ') + '= ' + tomlStr(r[1]) + '\n'; });
      t += '\n';
    });
    var b = new Blob([t], { type: 'text/plain;charset=utf-8' });
    var u = URL.createObjectURL(b), a = document.createElement('a');
    a.href = u; a.download = l.toml; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 1000);
    toast('Exported ' + keys.length + ' lines to ' + l.toml);
  }

  // A small TOML reader: [tables], key = "basic" and key = """multi-line"""
  // strings with the usual escapes. It ignores everything else.
  function unescape(s) {
    return s.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, function (_, c) {
      if (c === 'n') return '\n'; if (c === 't') return '\t'; if (c === 'r') return '\r';
      if (c.charAt(0) === 'u' || c.charAt(0) === 'U') return String.fromCodePoint(parseInt(c.slice(1), 16));
      return c;
    });
  }
  function parseToml(text) {
    var out = {}, tbl = '', lines = text.replace(/\r\n?/g, '\n').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t || t.charAt(0) === '#') continue;
      var tm = t.match(/^\[([^\]]+)\]\s*(#.*)?$/);
      if (tm) { tbl = tm[1].trim(); continue; }
      var ml = t.match(/^([A-Za-z0-9_\-]+)\s*=\s*"""(.*)$/);
      if (ml) {
        var buf = ml[2], j = i;
        while (buf.indexOf('"""') < 0 && j + 1 < lines.length) { j++; buf += '\n' + lines[j]; }
        i = j;
        buf = buf.slice(0, buf.indexOf('"""')).replace(/^\n/, '').replace(/\\\n\s*/g, '');
        out[(tbl ? tbl + '.' : '') + ml[1]] = unescape(buf);
        continue;
      }
      var kv = t.match(/^([A-Za-z0-9_\-]+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*(#.*)?$/);
      if (kv) out[(tbl ? tbl + '.' : '') + kv[1]] = unescape(kv[2]);
    }
    return out;
  }
  function importFile(f) {
    var r = new FileReader();
    r.onload = function () {
      var data = parseToml(String(r.result)), n = 0, skip = 0;
      tr[st.lang] = tr[st.lang] || {};
      Object.keys(data).forEach(function (k) {
        var i = IDX[k];
        if (i === undefined || !data[k]) { skip++; return; }
        var g = gameOf(i);
        if (data[k] === g) return;
        tr[st.lang][k] = { v: data[k], s: EN[i] };
        n++;
      });
      save(); renderLangs(); renderTools(); renderRows(); renderProg();
      toast('Imported ' + n + ' lines from ' + f.name + (skip ? ' · ' + skip + ' unknown keys skipped' : ''));
    };
    r.readAsText(f);
  }

  // ── submit one key ───────────────────────────────────────────────────────
  // Package the language, key and value as form data, swap the button for a
  // thank-you, and POST it. A network failure must not break the thank-you.
  function submitKey(key, btn) {
    var m = mineOf(key);
    if (!m || !st.lang) { toast('Type a translation first'); return; }
    var fd = new FormData();
    fd.append('language', st.lang);
    fd.append('key', key);
    fd.append('value', m.v);
    fd.append('english', EN[IDX[key]]);
    fd.append('category', catOf(key));
    fd.append('timestamp', new Date().toISOString());
    fd.append('_subject', '[Stella Nova i18n] ' + st.lang + ' :: ' + key);
    fd.append('_captcha', 'false');
    fd.append('_template', 'box');
    if (btn) {
      var w = document.createElement('span');
      w.className = 'ty';
      w.innerHTML = '<b>Thank you!</b> Sent to Dave';
      btn.replaceWith(w);
    }
    fetch(BACKEND_URL, { method: 'POST', body: fd, headers: { Accept: 'application/json' } }).catch(function () {});
  }

  // ── toast ────────────────────────────────────────────────────────────────
  var toastT = null;
  function toast(m) {
    var el = $('toast');
    el.textContent = m;
    el.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.classList.remove('show'); }, 3000);
  }

  // ── events ───────────────────────────────────────────────────────────────
  function bind() {
    $('langs').addEventListener('click', function (ev) {
      var b = ev.target.closest('.lang');
      if (b && b.dataset.lang !== st.lang) pickLang(b.dataset.lang);
    });
    $('tools').addEventListener('click', function (ev) {
      var c = ev.target.closest('[data-cat]'), s = ev.target.closest('[data-status]');
      if (c) { st.cat = c.dataset.cat; st.sec = 'all'; st.shown = PAGE; saveUi(); renderTools(); renderRows(); renderProg(); }
      if (s) { st.status = s.dataset.status; st.shown = PAGE; renderTools(); renderRows(); }
    });
    $('tools').addEventListener('change', function (ev) {
      if (ev.target.id === 'secSel') { st.sec = ev.target.value; st.shown = PAGE; renderRows(); }
    });
    var deb = null;
    $('tools').addEventListener('input', function (ev) {
      if (ev.target.id !== 'q') return;
      st.q = ev.target.value;
      clearTimeout(deb);
      deb = setTimeout(function () { st.shown = PAGE; renderRows(); }, 200);
    });
    $('rows').addEventListener('input', function (ev) {
      if (ev.target.classList.contains('ti')) grow(ev.target);
    });
    $('rows').addEventListener('focusout', function (ev) {
      var t = ev.target;
      if (!t.classList || !t.classList.contains('ti')) return;
      if (commit(t)) {
        var row = rowOf(t);
        // Keep the textarea that has the focus now; refresh only the footer
        // and the status class, so a click on a row button still lands.
        var i = +row.dataset.i, fresh = document.createElement('div');
        fresh.innerHTML = rowHtml(i);
        var n = fresh.firstChild;
        row.className = n.className;
        row.querySelector('.r-head').innerHTML = n.querySelector('.r-head').innerHTML;
        row.querySelector('.r-foot').innerHTML = n.querySelector('.r-foot').innerHTML;
      }
    });
    $('rows').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]');
      if (b) {
        var row = rowOf(b), i = +row.dataset.i, t = row.querySelector('.ti');
        if (b.dataset.act === 'use') {
          t.value = gameOf(i) || ''; grow(t); t.focus();
        } else if (b.dataset.act === 'keep') {
          tr[st.lang][KEYS[i]].s = EN[i]; save(); renderProg(); refreshRow(i);
        } else if (b.dataset.act === 'clear') {
          delete tr[st.lang][KEYS[i]]; save(); renderProg(); refreshRow(i);
        } else if (b.dataset.act === 'submit') {
          if (commit(t)) { row = refreshRow(i); b = row.querySelector('[data-act="submit"]'); }
          submitKey(KEYS[i], b);
        }
        return;
      }
      if (ev.target.id === 'more') { st.shown += PAGE; renderRows(true); }
    });
    document.addEventListener('keydown', onKey);
    $('btnExport').addEventListener('click', exportToml);
    $('btnImport').addEventListener('click', function () { $('fi').click(); });
    $('fi').addEventListener('change', function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (f) importFile(f);
      ev.target.value = '';
    });
    $('btnClear').addEventListener('click', function () {
      var l = LANG[st.lang];
      if (!mineCount(st.lang)) { toast('No edits to clear'); return; }
      if (!window.confirm('Delete all ' + mineCount(st.lang) + ' of your ' + l.english + ' edits from this browser? You cannot undo this.')) return;
      tr[st.lang] = {}; save(); renderLangs(); renderTools(); renderRows(); renderProg();
      toast('Cleared your ' + l.english + ' edits');
    });
  }

  // ── boot ─────────────────────────────────────────────────────────────────
  function boot() {
    tr = readJSON(SK5) || {};
    if (!readJSON(SK5)) migrateV4();
    bind();
    renderLangs();
    var ui = readJSON(SKUI);
    var want = (location.hash || '').replace(/^#/, '') || (ui && ui.lang);
    if (ui && ui.cat) st.cat = ui.cat;
    if (want && LANG[want]) pickLang(want);
  }

  boot();
})();
