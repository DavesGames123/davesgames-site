// ============================================================================
//  WIKI  ·  pages/wiki/main.js — router, tree, portal, category, entry, search
// ────────────────────────────────────────────────────────────────────────────
//  This classic script reads window.SN_DATA (lib/game-data/catalog.js) and
//  draws the wiki into #view. The catalog holds names, labels, sprites and
//  links only. This file adds no game text and no game numbers. Every count
//  that the page shows is a count of catalog rows or links.
//
//  The location hash holds the route. A hashchange event draws the new route,
//  so the browser back and forward buttons work. A deep link draws on load.
//
//  Other scripts extend the page through window.SNWikiExt (see EXT below).
//  The editor scripts set it before this file runs. Without them, every
//  article section shows its empty state.
//
//  The DOM helper h() sets text with textContent only. This file never
//  writes data into innerHTML.
//
//  grep -n targets
//    const EXT          extension points (doc, recent, edit, lock, canLeave)
//    function h(        DOM helper
//    const REV          reverse link index
//    function tile(     sprite thumb or glyph tile
//    function buildTree tree: group -> category -> tier/group -> entry
//    function filterTree tree filter
//    function parseRoute route parser
//    function render(   route dispatch
//    function viewHome  portal home
//    function viewCat   category table and grid
//    function viewEntry entry article
//    function infobox(  infobox with sprite cycler
//    function seeAlso(  dense See also lists
//    function navbox(   bottom navbox
//    function search(   search scorer
//    function viewSearch search results
//    function initSuggest search box suggestions
//    function openSide  phone drawer
// ============================================================================
(function () {
  'use strict';

  var D = window.SN_DATA;
  var view = document.getElementById('view');
  if (!D || !D.entries) {
    view.textContent = 'The game catalog did not load (lib/game-data/catalog.js).';
    return;
  }

  // ── extension points ─────────────────────────────────────────────────────
  // editor.js fills these. The defaults keep the reading view complete.
  var EXT = Object.assign({
    ready: function () { return Promise.resolve(); },
    doc: function () { return null; },          // id -> { classification, designation, sections{} } or null
    meta: function () { return null; },         // id -> { state: 'draft'|'published', updated } or null
    recent: function () { return []; },         // -> [{ id, state, updated }]
    renderBody: null,                           // (src, entry) -> Node
    edit: function () { toast('The editor is not loaded on this page.'); },
    entryTools: function () {},                 // (entry, toolbarEl) -> add buttons
    lock: function () { toast('The editor is not loaded on this page.'); },
    unlocked: function () { return false; },
    canLeave: function () { return true; },
    discard: function () {}
  }, window.SNWikiExt || {});

  // ── DOM helpers ──────────────────────────────────────────────────────────
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      for (var k in props) {
        var v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { add(el, k); }); return; }
    el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
    return null;
  }
  var toastTimer = 0;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }

  // ── data index ───────────────────────────────────────────────────────────
  var CATS = D.categories.slice().sort(function (a, b) { return a.order - b.order; });
  var CAT = {}; CATS.forEach(function (c) { CAT[c.id] = c; });
  var ENTRIES = D.entries;
  var BY = {}; ENTRIES.forEach(function (e, i) { e._i = i; BY[e.id] = e; });
  var IN_CAT = {}; CATS.forEach(function (c) { IN_CAT[c.id] = []; });
  ENTRIES.forEach(function (e) { (IN_CAT[e.category] = IN_CAT[e.category] || []).push(e); });
  var GROUPS = [];
  CATS.forEach(function (c) {
    var g = GROUPS.find(function (x) { return x.label === c.group; });
    if (!g) { g = { label: c.group, cats: [] }; GROUPS.push(g); }
    g.cats.push(c);
  });
  var KINDS = [['madeFrom', 'Made from'], ['usedIn', 'Used in'], ['unlockedBy', 'Unlocked by'], ['unlocks', 'Unlocks'], ['related', 'Related']];
  // REV[t][k] lists the entries whose links[k] hold t.
  var REV = {};
  ENTRIES.forEach(function (e) { REV[e.id] = { madeFrom: [], usedIn: [], unlockedBy: [], unlocks: [], related: [] }; });
  ENTRIES.forEach(function (e) {
    KINDS.forEach(function (k) { (e.links[k[0]] || []).forEach(function (t) { if (REV[t]) REV[t][k[0]].push(e.id); }); });
  });
  var SPRITE_COUNT = ENTRIES.reduce(function (n, e) { return n + e.sprites.length; }, 0);
  var LINK_COUNT = ENTRIES.reduce(function (n, e) { return n + KINDS.reduce(function (m, k) { return m + e.links[k[0]].length; }, 0); }, 0);

  // A category can repeat one name. Add the slug tail so that
  // the tree and the lists can tell the rows apart.
  var DUPES = {};
  CATS.forEach(function (c) {
    var seen = {};
    IN_CAT[c.id].forEach(function (e) { seen[e.name] = (seen[e.name] || 0) + 1; });
    IN_CAT[c.id].forEach(function (e) { if (seen[e.name] > 1) DUPES[e.id] = true; });
  });
  function label(e) {
    if (!DUPES[e.id]) return e.name;
    var m = e.slug.match(/(\d+)$/);
    return e.name + ' ' + (m ? m[1] : e.slug);
  }
  function href(e) { return '#/e/' + e.category + '/' + e.slug; }
  function catHref(id) { return '#/c/' + id; }
  function initials(name) {
    var w = name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/);
    return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toUpperCase();
  }
  function glyphOf(e) { return e.fields.Symbol || e.fields.Glyph || initials(e.name); }
  function bucketKey(e) { return e.tier || e.group || ''; }
  function bucketLabel(cat, k) { return k || (cat === 'modules' ? 'Not in build palette' : 'Other'); }
  function natural(a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }); }

  // A sprite thumb, or a glyph tile when the entry has no sprite.
  function tile(e, cls, idx) {
    var src = e.sprites[idx || 0];
    if (src) {
      return h('span', { class: 'tile ' + (cls || '') + (e.category === 'planets' ? ' map' : '') },
        h('img', { src: '../../' + src, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }));
    }
    var g = glyphOf(e);
    return h('span', { class: 'tile glyph ' + (cls || '') + (g.length > 2 ? ' long' : ''), 'aria-hidden': 'true' }, g);
  }
  function chip(id, small) {
    var e = BY[id];
    if (!e) return null;
    return h('a', { class: 'chip' + (small ? ' sm' : ''), href: href(e), title: label(e) + ' · ' + CAT[e.category].label }, tile(e, 'xs'), h('span', null, label(e)));
  }
  function crumbs(parts) {
    var nav = h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' });
    parts.forEach(function (p, i) {
      if (i) add(nav, h('span', { class: 'sep', 'aria-hidden': 'true' }, '/'));
      add(nav, p[1] ? h('a', { href: p[1] }, p[0]) : h('span', null, p[0]));
    });
    return nav;
  }
  function stateBadge(id) {
    var m = EXT.meta(id);
    if (!m) return null;
    return h('span', { class: 'badge ' + m.state }, m.state === 'draft' ? 'Local draft' : 'Published');
  }
  function when(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return isNaN(d) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  // ── tree ─────────────────────────────────────────────────────────────────
  var treeEl = document.getElementById('tree');
  function buildTree() {
    var frag = document.createDocumentFragment();
    GROUPS.forEach(function (g) {
      var n = g.cats.reduce(function (s, c) { return s + IN_CAT[c.id].length; }, 0);
      var gd = h('details', { class: 't-grp', 'data-grp': g.label },
        h('summary', null, h('span', { class: 't-lab' }, g.label), h('span', { class: 't-n' }, n)));
      g.cats.forEach(function (c) {
        var list = IN_CAT[c.id];
        var cd = h('details', { class: 't-cat', 'data-cat': c.id },
          h('summary', null, h('a', { class: 't-lab', href: catHref(c.id), 'data-cat': c.id }, c.label), h('span', { class: 't-n' }, list.length)));
        var keys = [];
        list.forEach(function (e) { var k = bucketKey(e); if (keys.indexOf(k) < 0) keys.push(k); });
        if (keys.length === 1 && keys[0] === '') add(cd, leafList(list));
        else keys.forEach(function (k) {
          var sub = list.filter(function (e) { return bucketKey(e) === k; });
          var sd = h('details', { class: 't-sub' },
            h('summary', null, h('span', { class: 't-lab' }, bucketLabel(c.id, k)), h('span', { class: 't-n' }, sub.length)));
          // Resource ores and alloys have a tier and a group: nest the group.
          var inner = [];
          sub.forEach(function (e) { if (e.tier && e.group && inner.indexOf(e.group) < 0) inner.push(e.group); });
          if (inner.length > 1) inner.forEach(function (gk) {
            var s2 = sub.filter(function (e) { return e.group === gk; });
            add(sd, h('details', { class: 't-sub t-sub2' },
              h('summary', null, h('span', { class: 't-lab' }, gk), h('span', { class: 't-n' }, s2.length)), leafList(s2)));
          });
          else add(sd, leafList(sub));
          add(cd, sd);
        });
        add(gd, cd);
      });
      add(frag, gd);
    });
    treeEl.appendChild(frag);
  }
  function leafList(list) {
    return h('ul', { class: 't-list' }, list.map(function (e) {
      return h('li', null, h('a', { class: 't-leaf', href: href(e), 'data-id': e.id, 'data-k': (label(e) + ' ' + (e.tier || '') + ' ' + (e.group || '')).toLowerCase() }, tile(e, 'xxs'), h('span', null, label(e))));
    }));
  }
  function markTree(route) {
    $$('.cur', treeEl).forEach(function (a) { a.classList.remove('cur'); });
    var a = null;
    if (route.name === 'entry') a = $('a[data-id="' + cssq(route.id) + '"]', treeEl);
    else if (route.name === 'cat') a = $('a[data-cat="' + cssq(route.cat) + '"]', treeEl);
    if (!a) return;
    a.classList.add('cur');
    for (var p = a.parentElement; p && p !== treeEl; p = p.parentElement) {
      if (p.tagName === 'DETAILS') p.open = true;
    }
    // Scroll the tree only, never the page.
    var side = document.getElementById('side');
    var ar = a.getBoundingClientRect(), sr = side.getBoundingClientRect();
    if (ar.top < sr.top + 90 || ar.bottom > sr.bottom - 20) side.scrollTop += ar.top - sr.top - sr.height / 2;
  }
  function cssq(s) { return String(s).replace(/["\\]/g, '\\$&'); }
  function filterTree(q) {
    q = q.trim().toLowerCase();
    $$('.t-leaf', treeEl).forEach(function (a) {
      a.parentElement.hidden = !!q && a.getAttribute('data-k').indexOf(q) < 0;
    });
    // Bottom-up: a details element shows when any leaf in it shows.
    $$('details', treeEl).reverse().forEach(function (d) {
      if (!q) { d.hidden = false; return; }
      var any = $$('li', d).some(function (li) { return !li.hidden; });
      var catHit = d.matches('.t-cat') && d.getAttribute('data-cat') && CAT[d.getAttribute('data-cat')].label.toLowerCase().indexOf(q) >= 0;
      if (catHit) $$('li', d).forEach(function (li) { li.hidden = false; });
      d.hidden = !(any || catHit);
      d.open = !d.hidden;
    });
    if (!q) { $$('details', treeEl).forEach(function (d) { d.open = false; }); markTree(route); }
  }

  // ── router ───────────────────────────────────────────────────────────────
  var route = { name: 'home' };
  function parseRoute(hash) {
    var p = (hash || '').replace(/^#\/?/, '').replace(/%2F/gi, '/');  // accept encoded ids
    if (!p) return { name: 'home' };
    var parts = p.split('/');
    var dec = function (s) { try { return decodeURIComponent(s); } catch (e) { return s; } };
    if (parts[0] === 'c' && CAT[dec(parts[1])]) return { name: 'cat', cat: dec(parts[1]) };
    if (parts[0] === 'e') {
      var id = dec(parts[1] || '') + '/' + dec(parts[2] || '');
      return BY[id] ? { name: 'entry', id: id } : { name: 'missing', what: id };
    }
    if (parts[0] === 'search') return { name: 'search', q: dec(parts.slice(1).join('/')) };
    return { name: 'missing', what: p };
  }
  var curHash = location.hash;
  window.addEventListener('hashchange', function () {
    if (location.hash === curHash) return;
    if (!EXT.canLeave()) {
      if (!window.confirm('This section has unsaved changes. Leave and discard them?')) {
        history.replaceState(null, '', curHash || '#/');
        var back = shellNav();
        if (back) back(curHash || '#/', 'replace');  // put the shell URL back too
        return;
      }
      EXT.discard();
    }
    curHash = location.hash;
    render();
  });
  // In the shell (stella-nova/index.html) the shell owns the browser
  // history. A route change from script goes through parent.snNav, which
  // pushes one shell entry, and the frame hash changes with replaceState,
  // which adds no frame entry. A frame entry would die when the shell swaps
  // the frame out, and Back would then do nothing. Outside the shell, a plain
  // hash change does both jobs.
  function shellNav() {
    try { return window.parent !== window && typeof window.parent.snNav === 'function' ? window.parent.snNav : null; }
    catch (e) { return null; }
  }
  function navigate(hash) {
    if (hash === location.hash) return;
    var nav = shellNav();
    if (!nav) { location.hash = hash; return; }
    if (!EXT.canLeave()) {
      if (!window.confirm('This section has unsaved changes. Leave and discard them?')) return;
      EXT.discard();
    }
    history.replaceState(null, '', hash);
    curHash = location.hash;
    nav(hash);
    render();
  }
  window.addEventListener('beforeunload', function (ev) {
    if (!EXT.canLeave()) { ev.preventDefault(); ev.returnValue = ''; }
  });

  function render(keepScroll) {
    route = parseRoute(location.hash);
    view.textContent = '';
    view.className = 'view v-' + route.name;
    if (route.name === 'home') viewHome();
    else if (route.name === 'cat') viewCat(route.cat);
    else if (route.name === 'entry') viewEntry(BY[route.id]);
    else if (route.name === 'search') viewSearch(route.q);
    else viewMissing(route.what);
    markTree(route);
    closeSide();
    var q = document.getElementById('q');
    if (route.name === 'search' && document.activeElement !== q) q.value = route.q;
    if (!keepScroll) window.scrollTo(0, 0);
  }

  // ── portal home ──────────────────────────────────────────────────────────
  function viewHome() {
    document.title = 'Wiki // Stella Nova';
    var hero = h('section', { class: 'hero' },
      h('p', { class: 'kicker' }, 'Stella Nova'),
      h('h1', null, 'The Stella Nova ', h('em', null, 'Wiki')),
      h('p', { class: 'lede' }, 'Every named thing in the game, cross-linked. Pick a category, follow a link, or search.'),
      h('div', { class: 'hero-act' },
        h('button', { class: 'pill gold', type: 'button', onclick: randomEntry }, 'Random entry'),
        h('a', { class: 'pill', href: '#/c/resources' }, 'Browse resources'),
        h('a', { class: 'pill', href: '#/c/modules' }, 'Browse modules')));
    var stats = h('dl', { class: 'stats' },
      stat(ENTRIES.length, 'Entries'), stat(CATS.length, 'Categories'), stat(GROUPS.length, 'Groups'),
      stat(SPRITE_COUNT, 'Sprites'), stat(LINK_COUNT, 'Cross links'));
    var rec = EXT.recent();
    var recent = h('section', { class: 'panel recent' },
      h('h2', { class: 'h-sm' }, 'Recently edited'),
      rec.length
        ? h('ul', { class: 'rec-list' }, rec.slice(0, 8).map(function (r) {
            var e = BY[r.id]; if (!e) return null;
            return h('li', null, chip(e.id), h('span', { class: 'badge ' + r.state }, r.state === 'draft' ? 'Draft' : 'Published'), h('time', null, when(r.updated)));
          }))
        : h('p', { class: 'empty' }, 'No edits on this device yet. Unlock the editor from any article to start a draft.'));
    var groups = h('section', { class: 'grp' }, h('h2', { class: 'h-sm' }, 'Categories'), h('div', { class: 'cards' }, CATS.map(catCard)));
    add(view, [hero, stats, h('div', { class: 'home-cols' }, h('div', { class: 'home-main' }, groups), recent)]);
  }
  function stat(n, l) { return h('div', null, h('dt', null, l), h('dd', null, n.toLocaleString())); }
  function catCard(c) {
    var list = IN_CAT[c.id];
    var withS = list.filter(function (e) { return e.sprite; });
    var pick = (withS.length ? withS : list);
    var step = Math.max(1, Math.floor(pick.length / 4));
    var mosaic = h('span', { class: 'mosaic' + (withS.length ? '' : ' glyphs') });
    for (var i = 0; i < 4 && i * step < pick.length; i++) add(mosaic, tile(pick[i * step], 'mo'));
    return h('a', { class: 'card', href: catHref(c.id) }, mosaic,
      h('span', { class: 'card-k' }, c.group),
      h('span', { class: 'card-t' }, c.label),
      h('span', { class: 'card-n' }, list.length + (list.length === 1 ? ' entry' : ' entries') + (withS.length ? ' · ' + withS.length + ' with sprites' : '')));
  }
  function randomEntry() {
    var e = ENTRIES[Math.floor(Math.random() * ENTRIES.length)];
    navigate(href(e));
  }

  // ── category ─────────────────────────────────────────────────────────────
  var catSort = { key: null, dir: 1 };
  function viewCat(id) {
    var c = CAT[id], list = IN_CAT[id];
    document.title = c.label + ' // Stella Nova Wiki';
    var mode = store('sn-wiki-catview') === 'grid' ? 'grid' : 'table';
    var hasTier = list.some(function (e) { return e.tier; });
    var hasGroup = list.some(function (e) { return e.group; });
    var kinds = KINDS.filter(function (k) { return list.some(function (e) { return e.links[k[0]].length; }); });
    var hasRefs = list.some(function (e) { return refCount(e); });
    var cols = [{ k: 'name', l: 'Name' }];
    if (hasTier) cols.push({ k: 'tier', l: 'Tier' });
    if (hasGroup) cols.push({ k: 'group', l: 'Group' });
    kinds.forEach(function (k) { cols.push({ k: k[0], l: k[1], num: true }); });
    if (hasRefs) cols.push({ k: 'refs', l: 'Linked from', num: true });

    var filterIn = h('input', { class: 'field', type: 'search', placeholder: 'Filter ' + c.label.toLowerCase(), 'aria-label': 'Filter this category', spellcheck: 'false' });
    var tBtn = h('button', { type: 'button', 'aria-pressed': String(mode === 'table') }, 'Table');
    var gBtn = h('button', { type: 'button', 'aria-pressed': String(mode === 'grid') }, 'Grid');
    var body = h('div', { class: 'cat-body' });
    var sisters = GROUPS.find(function (g) { return g.label === c.group; }).cats.filter(function (x) { return x.id !== id; });

    add(view, [
      crumbs([['Wiki', '#/'], [c.group], [c.label]]),
      h('header', { class: 'page-head' },
        h('p', { class: 'kicker' }, c.group),
        h('h1', null, c.label),
        h('p', { class: 'sub' }, list.length + (list.length === 1 ? ' entry' : ' entries') + (sisters.length ? ' · also in ' + c.group + ': ' : ''),
          sisters.map(function (s, i) { return [i ? ', ' : '', h('a', { href: catHref(s.id) }, s.label)]; }))),
      h('div', { class: 'cat-tools' }, filterIn, h('div', { class: 'seg', role: 'group', 'aria-label': 'View' }, tBtn, gBtn)),
      body
    ]);

    function rows() {
      var q = filterIn.value.trim().toLowerCase();
      var r = list.filter(function (e) { return !q || (label(e) + ' ' + (e.tier || '') + ' ' + (e.group || '')).toLowerCase().indexOf(q) >= 0; });
      if (catSort.key) {
        var k = catSort.key;
        r = r.slice().sort(function (a, b) {
          var va = val(a, k), vb = val(b, k);
          var d = typeof va === 'number' ? va - vb : natural(va || '\uffff', vb || '\uffff');
          return (d || a._i - b._i) * catSort.dir;
        });
      }
      return r;
    }
    function val(e, k) {
      if (k === 'name') return label(e);
      if (k === 'tier') return e.tier || '';
      if (k === 'group') return e.group || '';
      if (k === 'refs') return refCount(e);
      return e.links[k].length;
    }
    function draw() {
      body.textContent = '';
      var r = rows();
      if (!r.length) { add(body, h('p', { class: 'empty' }, 'No entry matches that filter.')); return; }
      if (mode === 'grid') {
        add(body, h('div', { class: 'grid' }, r.map(function (e) {
          return h('a', { class: 'gcard', href: href(e) }, tile(e, 'lg'), h('span', { class: 'gname' }, label(e)), h('span', { class: 'gmeta' }, [e.tier, e.group].filter(Boolean).join(' · ')));
        })));
        return;
      }
      var thead = h('tr', null, h('th', { class: 'c-thumb', scope: 'col' }, h('span', { class: 'sr' }, 'Sprite')), cols.map(function (col) {
        var on = catSort.key === col.k;
        return h('th', { scope: 'col', class: col.num ? 'num' : '', 'aria-sort': on ? (catSort.dir > 0 ? 'ascending' : 'descending') : 'none' },
          h('button', { type: 'button', onclick: function () {
            if (catSort.key === col.k) { if (catSort.dir > 0) catSort.dir = -1; else catSort.key = null; } else { catSort.key = col.k; catSort.dir = col.num ? -1 : 1; }
            draw();
          } }, col.l, h('span', { class: 'sort', 'aria-hidden': 'true' }, on ? (catSort.dir > 0 ? '▲' : '▼') : '↕')));
      }));
      var tb = h('tbody', null, r.map(function (e) {
        return h('tr', null,
          h('td', { class: 'c-thumb' }, h('a', { href: href(e), tabindex: '-1', 'aria-hidden': 'true' }, tile(e, 'sm'))),
          cols.map(function (col) {
            if (col.k === 'name') return h('td', { class: 'c-name' }, h('a', { href: href(e) }, label(e)), stateBadge(e.id));
            var v = val(e, col.k);
            return h('td', { class: col.num ? 'num' + (v ? '' : ' zero') : '' }, col.num ? String(v) : (v || '—'));
          }));
      }));
      add(body, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, thead), tb)));
    }
    function setMode(m) {
      mode = m; store('sn-wiki-catview', m);
      tBtn.setAttribute('aria-pressed', String(m === 'table')); gBtn.setAttribute('aria-pressed', String(m === 'grid'));
      draw();
    }
    tBtn.addEventListener('click', function () { setMode('table'); });
    gBtn.addEventListener('click', function () { setMode('grid'); });
    filterIn.addEventListener('input', draw);
    draw();
  }
  function refCount(e) {
    var r = REV[e.id], n = 0;
    KINDS.forEach(function (k) { n += r[k[0]].length; });
    return n;
  }

  // ── entry ────────────────────────────────────────────────────────────────
  var SECTIONS = [
    ['overview', 'Overview'], ['in-the-game', 'In the game'], ['mechanics', 'Mechanics'], ['acquisition', 'Acquisition'],
    ['history', 'History'], ['trivia', 'Trivia'], ['gallery', 'Gallery'], ['notes', 'Notes']
  ];
  var FLAGS = [['structural', 'Structural'], ['furniture', 'Furniture'], ['turret', 'Turret'], ['thruster', 'Thruster'], ['docking', 'Docking'],
    ['interior', 'Inside walls'], ['exterior', 'Touches open space'], ['directional', 'Player picks a facing'], ['flag', 'Flies a flag']];

  function viewEntry(e) {
    var c = CAT[e.category];
    var doc = EXT.doc(e.id) || {};
    var m = EXT.meta(e.id);
    document.title = label(e) + ' // Stella Nova Wiki';
    var tools = h('div', { class: 'entry-tools' });
    var head = h('header', { class: 'page-head entry-head' },
      h('div', { class: 'title-row' }, h('h1', { id: 'entryTitle' }, label(e)), tools),
      h('p', { class: 'from' }, 'From the Stella Nova Wiki',
        m ? [' · ', h('span', { class: 'badge ' + m.state }, m.state === 'draft' ? 'Local draft' : 'Published'), m.updated ? h('span', { class: 'edited' }, ' last edited ' + when(m.updated)) : null] : null));
    var scp = (doc.classification || doc.designation)
      ? h('dl', { class: 'scp-head' },
          doc.designation ? h('div', null, h('dt', null, 'Designation'), h('dd', null, doc.designation)) : null,
          doc.classification ? h('div', null, h('dt', null, 'Classification'), h('dd', null, doc.classification)) : null)
      : null;

    var article = h('article', { class: 'article', 'aria-labelledby': 'entryTitle' });
    add(article, infobox(e));
    if (scp) add(article, scp);
    var toc = h('nav', { class: 'toc', 'aria-label': 'Contents' }, h('p', { class: 'toc-t' }, 'Contents'));
    var ol = h('ol');
    SECTIONS.concat([['see-also', 'See also']]).forEach(function (s, i) {
      add(ol, h('li', null, h('a', { href: '#sec-' + s[0], 'data-sec': s[0] }, h('span', { class: 'toc-n' }, String(i + 1)), s[1])));
    });
    add(toc, ol);
    toc.addEventListener('click', function (ev) {
      var a = ev.target.closest('a[data-sec]'); if (!a) return;
      ev.preventDefault();
      var t = document.getElementById('sec-' + a.getAttribute('data-sec'));
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    add(article, toc);

    var sections = doc.sections || {};
    SECTIONS.forEach(function (s) {
      var sec = h('section', { class: 'sec', id: 'sec-' + s[0], 'data-key': s[0] });
      var editBtn = h('button', { class: 'edit-link', type: 'button', onclick: function () { EXT.edit(e, s[0], sec); } }, 'Edit');
      add(sec, h('h2', null, h('span', null, s[1]), h('span', { class: 'edit-wrap' }, '[', editBtn, ']')));
      var bodyEl = h('div', { class: 'sec-body' });
      add(sec, bodyEl);
      fillSection(bodyEl, e, sections[s[0]]);
      add(article, sec);
    });
    add(article, seeAlso(e));
    add(article, navbox(e));

    add(view, [crumbs([['Wiki', '#/'], [c.group], [c.label, catHref(c.id)]].concat(e.tier ? [[e.tier]] : []).concat([[label(e)]])), head, article]);
    EXT.entryTools(e, tools);
  }
  // Fill one section body: rendered text, or the empty state.
  function fillSection(bodyEl, e, src) {
    bodyEl.textContent = '';
    var has = !!(src && String(src).trim() && EXT.renderBody);
    if (bodyEl.parentElement) bodyEl.parentElement.classList.toggle('is-empty', !has);
    if (has) { add(bodyEl, EXT.renderBody(src, e)); return; }
    add(bodyEl, h('p', { class: 'empty-sec' }, 'This section has no text yet. ',
      h('button', { class: 'link-btn', type: 'button', onclick: function () { EXT.edit(e, bodyEl.parentElement.getAttribute('data-key'), bodyEl.parentElement); } }, 'Edit this section')));
  }

  function infobox(e) {
    var c = CAT[e.category];
    var box = h('aside', { class: 'infobox', 'aria-label': 'Infobox' });
    add(box, h('div', { class: 'ib-title' }, label(e)));
    var idx = 0;
    var fig = h('figure', { class: 'ib-fig' + (e.category === 'planets' ? ' map' : '') + (e.category === 'ship-livery' ? ' layer' : '') + (e.sprites.length ? '' : ' none') });
    var strip = null;
    var count = h('span', { class: 'ib-count' });
    function show(i) {
      if (!e.sprites.length) return;
      idx = (i + e.sprites.length) % e.sprites.length;
      var img = $('img', fig);
      img.src = '../../' + e.sprites[idx];
      count.textContent = (idx + 1) + ' / ' + e.sprites.length;
      if (strip) $$('button', strip).forEach(function (b, j) { b.setAttribute('aria-current', String(j === idx)); });
    }
    if (e.sprites.length) {
      add(fig, h('img', { alt: label(e) + ' sprite', decoding: 'async', draggable: 'false' }));
      if (e.sprites.length > 1) {
        add(fig, h('button', { class: 'ib-nav prev', type: 'button', 'aria-label': 'Previous sprite', onclick: function () { show(idx - 1); } }, '‹'));
        add(fig, h('button', { class: 'ib-nav next', type: 'button', 'aria-label': 'Next sprite', onclick: function () { show(idx + 1); } }, '›'));
        add(fig, count);
        fig.addEventListener('click', function (ev) { if (ev.target.tagName === 'IMG') show(idx + 1); });
        strip = h('div', { class: 'ib-strip', role: 'group', 'aria-label': 'Sprite variants' }, e.sprites.map(function (s, j) {
          return h('button', { type: 'button', 'aria-label': 'Variant ' + (j + 1), onclick: function () { show(j); } }, h('img', { src: '../../' + s, alt: '', loading: 'lazy', draggable: 'false' }));
        }));
      }
    } else {
      add(fig, h('span', { class: 'ib-glyph' + (glyphOf(e).length > 2 ? ' long' : '') }, glyphOf(e)));
      add(fig, h('figcaption', null, 'No sprite in the game files'));
    }
    add(box, fig);
    if (strip) add(box, strip);
    if (e.sprites.length) show(0);
    box.tabIndex = 0;
    box.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowLeft') { show(idx - 1); ev.preventDefault(); }
      if (ev.key === 'ArrowRight') { show(idx + 1); ev.preventDefault(); }
    });
    box._show = function (d) { show(idx + d); };

    var tb = h('tbody');
    function row(k, v) { add(tb, h('tr', null, h('th', { scope: 'row' }, k), h('td', null, v))); }
    function band(t) { add(tb, h('tr', { class: 'band' }, h('th', { colspan: '2', scope: 'colgroup' }, t))); }
    band('Classification');
    row('Category', h('a', { href: catHref(c.id) }, c.label));
    row('Section', c.group);
    if (e.tier) row('Tier', e.tier);
    if (e.group) row('Group', e.group);
    var fk = Object.keys(e.fields);
    if (fk.length) {
      band('Details');
      fk.forEach(function (k) {
        var v = e.fields[k];
        if (/ words$/.test(k)) row(k, h('span', { class: 'words' }, v.split(/,\s*/).map(function (w) { return h('span', null, w); })));
        else row(k, h('span', { class: k === 'Symbol' || k === 'Glyph' ? 'sym' : '' }, v));
      });
    }
    if (e.placement) {
      var on = FLAGS.filter(function (f) { return e.placement[f[0]]; });
      band('Placement');
      row('Rules', on.length ? h('span', { class: 'flags' }, on.map(function (f) { return h('span', null, f[1]); })) : h('span', { class: 'dim' }, 'None'));
    }
    var lk = linkRows(e);
    if (lk.length) {
      band('Links');
      lk.forEach(function (r) { row(r[0], h('span', { class: 'chips' }, r[1].map(function (id) { return chip(id, true); }))); });
    }
    add(box, h('table', { class: 'ib-table' }, tb));
    return box;
  }
  function linkRows(e) {
    var L = e.links, out = [];
    if (L.madeFrom.length) out.push(['Made from', L.madeFrom]);
    if (L.usedIn.length) out.push(['Used in', L.usedIn]);
    if (L.unlockedBy.length) out.push([e.category === 'research' ? 'Requires' : 'Unlocked by', L.unlockedBy]);
    if (e.category === 'research') {
      var items = L.unlocks.filter(function (id) { return id.indexOf('research/') !== 0; });
      var next = L.unlocks.filter(function (id) { return id.indexOf('research/') === 0; });
      if (items.length) out.push(['Unlocks', items]);
      if (next.length) out.push(['Leads to', next]);
    } else if (L.unlocks.length) out.push(['Unlocks', L.unlocks]);
    if (L.related.length) out.push(['Related', L.related]);
    return out;
  }

  // ── See also ─────────────────────────────────────────────────────────────
  // Built from catalog links only: direct links, reverse links, second
  // degree links, research chains, same tier, same group, the category, and
  // the sister categories in the same section.
  function seeAlso(e) {
    var groups = [], used = {};
    used[e.id] = true;
    function put(title, ids, opt) {
      var seen = {};
      ids = ids.filter(function (id) { if (!BY[id] || id === e.id || seen[id]) return false; seen[id] = true; return true; });
      if (opt && opt.fresh) ids = ids.filter(function (id) { return !used[id]; });
      if (!ids.length) return;
      ids.forEach(function (id) { used[id] = true; });
      groups.push([title, ids]);
    }
    var L = e.links, R = REV[e.id];
    linkRows(e).forEach(function (r) { put(r[0], r[1]); });
    put('Linked from', [].concat(R.madeFrom, R.usedIn, R.unlockedBy, R.unlocks, R.related), { fresh: true });
    if (e.category === 'research') {
      put('Earlier research', walk(e.id, function (x) { return BY[x].links.unlockedBy; }), { fresh: true });
      put('Later research', walk(e.id, function (x) { return BY[x].links.unlocks.filter(function (i) { return i.indexOf('research/') === 0; }); }), { fresh: true });
    } else {
      var gate = [].concat(L.unlockedBy, R.unlocks.filter(function (i) { return i.indexOf('research/') === 0; }));
      put('Research that unlocks it', gate, { fresh: true });
    }
    if (L.madeFrom.length) {
      put('Shares inputs with', ENTRIES.filter(function (x) { return x.links.madeFrom.some(function (i) { return L.madeFrom.indexOf(i) >= 0; }); }).map(function (x) { return x.id; }));
    }
    if (L.usedIn.length) {
      put('Used next to it in', ENTRIES.filter(function (x) { return x.links.usedIn.some(function (i) { return L.usedIn.indexOf(i) >= 0; }); }).map(function (x) { return x.id; }), { fresh: true });
    }
    var sibs = IN_CAT[e.category];
    if (e.tier) put('Same tier: ' + e.tier, sibs.filter(function (x) { return x.tier === e.tier; }).map(function (x) { return x.id; }));
    if (e.group) put('Same group: ' + e.group, sibs.filter(function (x) { return x.group === e.group; }).map(function (x) { return x.id; }));
    put('Also in ' + CAT[e.category].label, sibs.map(function (x) { return x.id; }), { fresh: true });
    var g = GROUPS.find(function (x) { return x.label === CAT[e.category].group; });
    var sister = [];
    g.cats.forEach(function (c) { if (c.id !== e.category) sister = sister.concat(IN_CAT[c.id]); });
    if (sister.length) {
      var step = Math.max(1, Math.floor(sister.length / 30)), off = hash(e.id) % step, pick = [];
      for (var i = off; i < sister.length && pick.length < 30; i += step) pick.push(sister[i].id);
      put('More from ' + g.label, pick, { fresh: true });
    }

    var sec = h('section', { class: 'sec see', id: 'sec-see-also' }, h('h2', null, h('span', null, 'See also')));
    var total = groups.reduce(function (n, x) { return n + x[1].length; }, 0);
    add(sec, h('p', { class: 'see-n' }, total + ' links from the catalog'));
    add(sec, h('div', { class: 'see-cols' }, groups.map(function (gr) {
      return h('div', { class: 'see-g' }, h('h3', null, gr[0], h('span', { class: 't-n' }, gr[1].length)),
        h('ul', null, gr[1].map(function (id) { var x = BY[id]; return h('li', null, h('a', { href: href(x) }, tile(x, 'xxs'), h('span', null, label(x)), x.category !== e.category ? h('small', null, CAT[x.category].label) : null)); })));
    })));
    if (g.cats.length > 1) {
      add(sec, h('p', { class: 'see-cats' }, 'Categories in ' + g.label + ': ', g.cats.map(function (c, i) {
        return [i ? ' · ' : '', c.id === e.category ? h('b', null, c.label) : h('a', { href: catHref(c.id) }, c.label)];
      })));
    }
    return sec;
  }
  function walk(start, next) {
    var out = [], seen = {}, q = next(start).slice();
    while (q.length) { var x = q.shift(); if (seen[x] || !BY[x]) continue; seen[x] = true; out.push(x); q = q.concat(next(x)); }
    return out;
  }
  function hash(s) { var n = 0; for (var i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0; return n; }

  // ── navbox ───────────────────────────────────────────────────────────────
  function navbox(e) {
    var c = CAT[e.category], list = IN_CAT[c.id];
    var tb = h('tbody');
    var keys = [];
    list.forEach(function (x) { var k = bucketKey(x); if (keys.indexOf(k) < 0) keys.push(k); });
    keys.forEach(function (k) {
      var sub = list.filter(function (x) { return bucketKey(x) === k; });
      add(tb, h('tr', null, h('th', { scope: 'row' }, keys.length === 1 && !k ? c.label : bucketLabel(c.id, k)),
        h('td', null, h('ul', { class: 'nb-list' }, sub.map(function (x) {
          return h('li', null, x.id === e.id ? h('b', null, label(x)) : h('a', { href: href(x) }, label(x)));
        })))));
    });
    var g = GROUPS.find(function (x) { return x.label === c.group; });
    add(tb, h('tr', { class: 'nb-foot' }, h('th', { scope: 'row' }, g.label),
      h('td', null, h('ul', { class: 'nb-list' }, g.cats.map(function (x) {
        return h('li', null, x.id === c.id ? h('b', null, x.label) : h('a', { href: catHref(x.id) }, x.label));
      })))));
    return h('details', { class: 'navbox', open: true },
      h('summary', null, h('a', { href: catHref(c.id) }, c.label), h('span', { class: 'nb-hint' }, 'hide / show')),
      h('table', null, tb));
  }

  // ── search ───────────────────────────────────────────────────────────────
  var HAY = ENTRIES.map(function (e) {
    var c = CAT[e.category];
    return { e: e, name: label(e).toLowerCase(), rest: [c.label, c.group, e.tier, e.group].concat(Object.values(e.fields)).filter(Boolean).join(' ').toLowerCase() };
  });
  function search(q) {
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    var out = [];
    HAY.forEach(function (x) {
      var s = 0;
      for (var i = 0; i < terms.length; i++) {
        var t = terms[i];
        var n = x.name.indexOf(t);
        if (n === 0) s += 60; else if (n > 0) s += (x.name[n - 1] === ' ' ? 40 : 25);
        else if (x.rest.indexOf(t) >= 0) s += 8;
        else return;
      }
      if (x.name === q.toLowerCase().trim()) s += 100;
      out.push({ e: x.e, s: s });
    });
    out.sort(function (a, b) { return b.s - a.s || CAT[a.e.category].order - CAT[b.e.category].order || a.e._i - b.e._i; });
    return out.map(function (r) { return r.e; });
  }
  function marked(text, q) {
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    var lower = text.toLowerCase(), out = [], i = 0;
    while (i < text.length) {
      var best = -1, len = 0;
      terms.forEach(function (t) { var n = lower.indexOf(t, i); if (n >= 0 && (best < 0 || n < best)) { best = n; len = t.length; } });
      if (best < 0) { out.push(text.slice(i)); break; }
      if (best > i) out.push(text.slice(i, best));
      out.push(h('mark', null, text.slice(best, best + len)));
      i = best + len;
    }
    return out;
  }
  function viewSearch(q) {
    document.title = 'Search: ' + q + ' // Stella Nova Wiki';
    var res = search(q);
    var cats = CATS.filter(function (c) { return q && (c.label + ' ' + c.group).toLowerCase().indexOf(q.toLowerCase().trim()) >= 0; });
    add(view, [crumbs([['Wiki', '#/'], ['Search']]),
      h('header', { class: 'page-head' }, h('p', { class: 'kicker' }, 'Search'), h('h1', null, q ? ['Results for ', h('em', null, q)] : 'Search'),
        h('p', { class: 'sub' }, q ? res.length + (res.length === 1 ? ' entry' : ' entries') + (cats.length ? ' · ' + cats.length + ' categories' : '') : 'Type in the search field above.'))]);
    if (cats.length) add(view, h('div', { class: 'res-cats' }, cats.map(function (c) { return h('a', { class: 'pill', href: catHref(c.id) }, c.label, h('span', { class: 't-n' }, IN_CAT[c.id].length)); })));
    if (q && !res.length && !cats.length) add(view, h('p', { class: 'empty' }, 'Nothing matches. Try a shorter word, a tier such as "Alloys", or a category such as "Quirks".'));
    add(view, h('ol', { class: 'results' }, res.slice(0, 200).map(function (e) {
      return h('li', null, h('a', { href: href(e) }, tile(e, 'sm'),
        h('span', { class: 'r-txt' }, h('span', { class: 'r-name' }, marked(label(e), q)),
          h('span', { class: 'r-meta' }, [CAT[e.category].label, e.tier, e.group].filter(Boolean).join(' · ')))));
    })));
    if (res.length > 200) add(view, h('p', { class: 'empty' }, 'The first 200 results show. Add a word to narrow the list.'));
  }
  function viewMissing(what) {
    document.title = 'Not found // Stella Nova Wiki';
    add(view, [crumbs([['Wiki', '#/'], ['Not found']]),
      h('header', { class: 'page-head' }, h('p', { class: 'kicker' }, 'Not found'), h('h1', null, 'No such page'),
        h('p', { class: 'sub' }, 'The wiki has no page at "' + what + '". ', h('a', { href: '#/search/' + encodeURIComponent(what.split('/').pop()) }, 'Search for it'), ' or go to the ', h('a', { href: '#/' }, 'portal'), '.'))]);
  }

  // ── search box with suggestions ──────────────────────────────────────────
  function initSuggest() {
    var form = document.getElementById('searchForm'), q = document.getElementById('q'), list = document.getElementById('suggest');
    var items = [], sel = -1;
    function close() { list.hidden = true; sel = -1; q.setAttribute('aria-expanded', 'false'); }
    function paint() {
      $$('li', list).forEach(function (li, i) { li.setAttribute('aria-selected', String(i === sel)); });
    }
    q.addEventListener('input', function () {
      var v = q.value.trim();
      list.textContent = '';
      if (!v) { close(); return; }
      items = search(v).slice(0, 8);
      items.forEach(function (e, i) {
        add(list, h('li', { role: 'option', id: 'sg' + i, 'aria-selected': 'false',
          onpointerdown: function (ev) { ev.preventDefault(); },
          onclick: function () { go(e); } },
          tile(e, 'xs'), h('span', { class: 'r-name' }, marked(label(e), v)), h('small', null, CAT[e.category].label)));
      });
      add(list, h('li', { role: 'option', class: 'all', 'aria-selected': 'false', onpointerdown: function (ev) { ev.preventDefault(); }, onclick: function () { submit(); } }, 'All results for "' + v + '"'));
      sel = -1; list.hidden = false; q.setAttribute('aria-expanded', 'true');
    });
    q.addEventListener('keydown', function (ev) {
      var n = $$('li', list).length;
      if (list.hidden || !n) return;
      if (ev.key === 'ArrowDown') { sel = (sel + 1) % n; paint(); ev.preventDefault(); }
      else if (ev.key === 'ArrowUp') { sel = (sel - 1 + n) % n; paint(); ev.preventDefault(); }
      else if (ev.key === 'Escape') { close(); }
      else if (ev.key === 'Enter' && sel >= 0) { ev.preventDefault(); if (sel < items.length) go(items[sel]); else submit(); }
    });
    q.addEventListener('blur', function () { setTimeout(close, 120); });
    function go(e) { close(); q.blur(); navigate(href(e)); }
    function submit() { var v = q.value.trim(); close(); q.blur(); if (v) navigate('#/search/' + encodeURIComponent(v)); }
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (sel >= 0 && sel < items.length) go(items[sel]); else submit();
    });
    document.addEventListener('keydown', function (ev) {
      var t = ev.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (typing) return;
      if (ev.key === '/' && !ev.metaKey && !ev.ctrlKey) { ev.preventDefault(); q.focus(); q.select(); }
      if (route.name === 'entry' && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && !(t && t.closest && t.closest('.infobox'))) {
        var box = $('.infobox', view);
        if (box && box._show && !ev.altKey && !ev.metaKey) box._show(ev.key === 'ArrowLeft' ? -1 : 1);
      }
    });
  }

  // ── phone drawer ─────────────────────────────────────────────────────────
  var side = document.getElementById('side'), scrim = document.getElementById('scrim'), menuBtn = document.getElementById('menuBtn');
  function openSide() { side.classList.add('open'); scrim.hidden = false; menuBtn.setAttribute('aria-expanded', 'true'); document.body.classList.add('drawer'); }
  function closeSide() { side.classList.remove('open'); scrim.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); document.body.classList.remove('drawer'); }
  menuBtn.addEventListener('click', function () { if (side.classList.contains('open')) closeSide(); else openSide(); });
  scrim.addEventListener('click', closeSide);
  document.getElementById('sideClose').addEventListener('click', closeSide);
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && side.classList.contains('open')) closeSide(); });
  // Swipe left on the open drawer to close it.
  var sx = null;
  side.addEventListener('pointerdown', function (ev) { if (ev.pointerType !== 'mouse') sx = ev.clientX; });
  side.addEventListener('pointerup', function (ev) { if (sx != null && sx - ev.clientX > 60) closeSide(); sx = null; });
  side.addEventListener('pointercancel', function () { sx = null; });

  // ── boot ─────────────────────────────────────────────────────────────────
  buildTree();
  var tq = document.getElementById('treeQ'), tqTimer = 0;
  tq.addEventListener('input', function () { clearTimeout(tqTimer); tqTimer = setTimeout(function () { filterTree(tq.value); }, 80); });
  document.getElementById('treeOpen').addEventListener('click', function () { $$('details', treeEl).forEach(function (d) { if (!d.hidden) d.open = true; }); });
  document.getElementById('treeShut').addEventListener('click', function () { $$('details', treeEl).forEach(function (d) { d.open = false; }); markTree(route); });
  document.getElementById('lockBtn').addEventListener('click', function () { EXT.lock(); });
  initSuggest();

  // Shared API for editor.js and tests.
  window.SNWiki = {
    h: h, add: add, toast: toast, tile: tile, label: label, href: href, BY: BY, CAT: CAT, ENTRIES: ENTRIES,
    SECTIONS: SECTIONS, search: search, render: render, fillSection: fillSection,
    route: function () { return route; }, setHash: function (hsh) { curHash = hsh; }
  };

  Promise.resolve(EXT.ready()).catch(function () {}).then(function () { render(); });
})();
