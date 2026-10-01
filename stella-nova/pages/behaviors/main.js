// ============================================================================
//  CITIZEN BEHAVIORS  ·  catalog links, behavior index and scroll spy
// ----------------------------------------------------------------------------
//  Classic script at the end of body. The written sections are static HTML.
//  This file adds the parts that come from window.SN_DATA:
//
//    section[data-entry] ─▶ addLinks()   ─▶ wiki chip + related skill/job chips
//    .o-item[data-entry] ─▶ addLinks()   ─▶ small wiki chip after the name
//    #idxGrid            ─▶ buildIndex() ─▶ one card per catalog behavior,
//                                           names only, body left blank
//    window scroll       ─▶ measure()    ─▶ .on on the nav link
//
//  Wiki links use the wiki page route: ../wiki/index.html#/e/<category>/<slug>
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//    wiki route ......... "var WIKI"              link prefix and builder
//    section chips ...... "function addLinks"     wiki and related chips
//    index cards ........ "function buildIndex"   catalog behavior grid
//    index filter ....... "function filterIndex"  name filter
//    scroll spy ......... "function spy"          active nav link
//    boot ............... "addLinks();"           last block runs it all
// ============================================================================
(function () {
  'use strict';

  var DATA = window.SN_DATA || { entries: [] };
  var BY = {};
  DATA.entries.forEach(function (e) { BY[e.id] = e; });
  var WIKI = '../wiki/index.html#/e/';
  function wikiHref(e) { return WIKI + encodeURIComponent(e.category) + '/' + encodeURIComponent(e.slug); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  // Catalog behaviors that have a written section on this page. Rescue, Idle
  // and Visitor live in the Other list.
  var WRITTEN = {};
  document.querySelectorAll('[data-entry]').forEach(function (n) {
    var sec = n.closest('section');
    WRITTEN[n.getAttribute('data-entry')] = sec ? sec.id : null;
  });

  // A chip that opens an entry in the wiki. kind is the small prefix label.
  function chip(e, kind, isWiki) {
    var a = el('a', 'chip' + (isWiki ? ' wiki' : ''));
    a.href = wikiHref(e);
    if (kind) a.appendChild(el('span', 'k', kind));
    a.appendChild(document.createTextNode(isWiki ? 'Wiki entry' : e.name));
    a.title = 'Open ' + e.name + ' in the wiki';
    return a;
  }

  // Related entries of a behavior, skills first, then jobs.
  function related(e) {
    var r = (e.links && e.links.related) || [];
    return r.map(function (id) { return BY[id]; }).filter(Boolean).sort(function (a, b) { return a.category < b.category ? 1 : -1; });
  }
  function kindOf(e) { return e.category === 'skills' ? 'Skill' : e.category === 'jobs' ? 'Job' : ''; }

  // Fill each written section's .beh-links slot, and put a small wiki chip
  // after each linked name in the Other list.
  function addLinks() {
    document.querySelectorAll('section.beh[data-entry]').forEach(function (sec) {
      var e = BY[sec.getAttribute('data-entry')];
      var slot = sec.querySelector('.beh-links');
      if (!e || !slot) return;
      slot.appendChild(chip(e, '', true));
      related(e).forEach(function (r) { slot.appendChild(chip(r, kindOf(r), false)); });
    });
    document.querySelectorAll('.o-item[data-entry]').forEach(function (it) {
      var e = BY[it.getAttribute('data-entry')];
      var h = it.querySelector('h3');
      if (e && h) h.appendChild(chip(e, '', true));
    });
  }

  // One card per catalog behavior, by name. The card opens the wiki entry.
  // A behavior with a written section also gets a link to that section.
  // There is no description: the body stays blank by rule.
  function buildIndex() {
    var list = DATA.entries.filter(function (e) { return e.category === 'behaviors'; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    var grid = document.getElementById('idxGrid');
    var count = document.getElementById('idxCount');
    if (count) count.textContent = list.length ? String(list.length) : '';
    list.forEach(function (e) {
      var card = el('article', 'card');
      card.dataset.name = e.name.toLowerCase();
      var cover = el('a', 'cover'); cover.href = wikiHref(e); cover.setAttribute('aria-label', e.name + ' in the wiki');
      card.appendChild(cover);
      var top = el('div', 'top');
      top.appendChild(el('h3', '', e.name));
      top.appendChild(el('span', 'go', 'Wiki'));
      card.appendChild(top);
      card.appendChild(el('div', 'body-blank'));
      var rel = el('div', 'rel');
      var sec = WRITTEN[e.id];
      if (sec) {
        var s = el('a', 'chip'); s.href = '#' + sec;
        s.appendChild(el('span', 'k', 'Read')); s.appendChild(document.createTextNode('Section'));
        rel.appendChild(s);
        card.classList.add('written');
        var src = document.getElementById(sec);
        if (src) card.style.setProperty('--c2', getComputedStyle(src).getPropertyValue('--c'));
      }
      related(e).forEach(function (r) { rel.appendChild(chip(r, kindOf(r), false)); });
      if (rel.childNodes.length) card.appendChild(rel);
      grid.appendChild(card);
    });
    if (!list.length) document.getElementById('idxEmpty').hidden = false;
  }

  // Show only the cards whose name holds the filter text.
  function filterIndex(q) {
    q = q.trim().toLowerCase();
    var shown = 0;
    document.querySelectorAll('#idxGrid .card').forEach(function (c) {
      var hit = !q || c.dataset.name.indexOf(q) !== -1;
      c.hidden = !hit; if (hit) shown++;
    });
    document.getElementById('idxEmpty').hidden = shown !== 0;
  }

  // Scroll spy. A section is active when it crosses a band near the top of
  // the window. On a phone the active chip also scrolls into view in the bar.
  function spy() {
    var links = Array.prototype.slice.call(document.querySelectorAll('#toc .toc-a'));
    var map = {};
    links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var current = null;
    function setOn(id) {
      if (id === current || !map[id]) return;
      current = id;
      links.forEach(function (a) { a.classList.toggle('on', a === map[id]); });
      var bar = document.getElementById('toc');
      if (bar.scrollWidth > bar.clientWidth + 4) {
        var a = map[id], left = a.offsetLeft - (bar.clientWidth - a.offsetWidth) / 2;
        bar.scrollTo({ left: left, behavior: 'smooth' });
      }
    }
    // The active section is the last one whose top is above a line at 30%
    // of the window. At the end of the page the last section wins.
    var ids = Object.keys(map).filter(function (id) { return document.getElementById(id); });
    var queued = false;
    function measure() {
      queued = false;
      var line = window.innerHeight * 0.3, pick = ids[0];
      ids.forEach(function (id) { if (document.getElementById(id).getBoundingClientRect().top <= line) pick = id; });
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) pick = ids[ids.length - 1];
      setOn(pick);
    }
    window.addEventListener('scroll', function () { if (!queued) { queued = true; requestAnimationFrame(measure); } }, { passive: true });
    window.addEventListener('resize', measure);
    measure();
  }

  addLinks();
  buildIndex();
  var f = document.getElementById('idxFilter');
  if (f) f.addEventListener('input', function () { filterIndex(f.value); });
  spy();
})();
