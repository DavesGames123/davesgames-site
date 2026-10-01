// ============================================================================
//  CRAFTING CHAINS  ·  pages/crafting/main.js — production-chain explorer
// ----------------------------------------------------------------------------
//  Classic script. It reads window.SN_DATA (lib/game-data/catalog.js) and
//  builds a graph of resources and buildable station modules from the
//  catalog links. The page shows names, tiers, sprites and links only. It
//  has no quantity, time, rate or cost, because the catalog has none.
//
//  DATA PATH
//    SN_DATA.entries ─▶ NODES (resources + buildable modules)
//                     ─▶ UP[id]   = madeFrom, limited to NODES
//                     ─▶ DOWN[id] = usedIn,   limited to NODES
//    focus(id) ─▶ closure(UP) + closure(DOWN) ─▶ lit cards, lit wires,
//                                                 panel, phone list marks
//
//  VIEWS
//    desktop  #board  tier columns, SVG wires behind the cards
//    phone    #tabs + #list  one column at a time, chain marks on rows
//    both     #panel  detail of the focused item (drawer or bottom sheet
//                     below 1280px)
//
//  GREP TARGETS  (grep -n "<target>" main.js)
//    column plan ......... "var COLS"
//    graph build ......... "function buildGraph"
//    chain closure ....... "function closure"
//    board render ........ "function renderBoard"
//    wire geometry ....... "function drawWires"
//    phone render ........ "function renderPhone"
//    focus state ......... "function focus"
//    detail panel ........ "function renderPanel"
//    need tree ........... "function needTree"
//    search .............. "function applySearch"
//    sheet open/close .... "function openSheet"
//    deep link ........... "location.hash"
//    boot ................ "function boot"
// ============================================================================
(function () {
  'use strict';

  var D = window.SN_DATA;
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = 'http://www.w3.org/2000/svg';

  // Column plan. Each column takes catalog tiers (resources) or the buildable
  // modules. Group labels inside a column come from the entry group or tier.
  var COLS = [
    { id: 'ores',       label: 'Ores',            tiers: ['Ores'],        groupBy: 'group' },
    { id: 'ingots',     label: 'Ingots',          tiers: ['Ingots'],      groupBy: null },
    { id: 'alloys',     label: 'Alloys',          tiers: ['Alloys'],      groupBy: 'group' },
    { id: 'components', label: 'Components',      tiers: ['Components'],  groupBy: 'group' },
    { id: 'products',   label: 'End products',    tiers: ['Consumables', 'Propellants', 'Exotics', 'Knowledge', 'Currency'], groupBy: 'tier' },
    { id: 'modules',    label: 'Modules',         modules: true,          groupBy: 'section',
      order: ['Structure', 'Habitat', 'Production', 'Utility', 'Research', 'Decorations', 'Antimatter'] }
  ];

  var E = {};          // id -> catalog entry
  var NODES = [];      // node ids in display order
  var COL_OF = {};     // id -> column index
  var GROUP_OF = {};   // id -> group label inside its column
  var UP = {};         // id -> input ids
  var DOWN = {};       // id -> output ids
  var EDGES = [];      // [from, to]
  var CARD = {};       // id -> board card element
  var WIRE = [];       // { from, to, el }
  var state = { focus: null, hover: null, tab: 0, query: '' };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function src(p) { return '../../' + p; }
  function isNarrow() { return window.matchMedia('(max-width: 760px)').matches; }
  function isSheet() { return window.matchMedia('(max-width: 1279px)').matches; }

  // ── graph ────────────────────────────────────────────────────────────────
  function buildGraph() {
    D.entries.forEach(function (e) { E[e.id] = e; });
    COLS.forEach(function (col, ci) {
      var rows = D.entries.filter(function (e) {
        if (col.modules) {
          return e.category === 'modules' && e.fields && e.fields.Status === 'Buildable' && e.links.madeFrom.length;
        }
        return e.category === 'resources' && col.tiers.indexOf(e.tier) >= 0;
      });
      // Array.prototype.sort is stable, so catalog order holds inside a group.
      if (col.groupBy === 'tier') {
        rows.sort(function (a, b) { return col.tiers.indexOf(a.tier) - col.tiers.indexOf(b.tier); });
      } else if (col.order) {
        var rank = function (e) { var i = col.order.indexOf(e.group); return i < 0 ? col.order.length : i; };
        rows.sort(function (a, b) { return rank(a) - rank(b); });
      }
      rows.forEach(function (e) {
        NODES.push(e.id);
        COL_OF[e.id] = ci;
        var g = null;
        if (col.groupBy === 'group') g = e.group;
        else if (col.groupBy === 'tier') g = e.tier;
        else if (col.groupBy === 'section') g = e.group || 'Other';
        GROUP_OF[e.id] = g;
      });
    });
    var inSet = {};
    NODES.forEach(function (id) { inSet[id] = true; UP[id] = []; DOWN[id] = []; });
    NODES.forEach(function (id) {
      E[id].links.madeFrom.forEach(function (m) {
        if (inSet[m] && UP[id].indexOf(m) < 0) { UP[id].push(m); DOWN[m].push(id); EDGES.push([m, id]); }
      });
    });
  }

  function closure(start, map) {
    var seen = {}, stack = map[start].slice();
    while (stack.length) {
      var id = stack.pop();
      if (seen[id]) continue;
      seen[id] = true;
      (map[id] || []).forEach(function (n) { if (!seen[n]) stack.push(n); });
    }
    return seen;
  }

  // ── shared bits ──────────────────────────────────────────────────────────
  function symbolOf(e) { return (e.fields && e.fields.Symbol) || e.name.charAt(0); }
  function icon(e, cls) {
    cls = cls || 'ic';
    if (e.sprite) return '<span class="' + cls + '"><img src="' + esc(src(e.sprite)) + '" alt="" loading="lazy" decoding="async"></span>';
    return '<span class="' + cls + ' glyph" aria-hidden="true">' + esc(symbolOf(e)) + '</span>';
  }
  function kindLabel(e) {
    if (e.category === 'modules') return 'Station module' + (e.group ? ' · ' + e.group : '');
    return (e.tier || 'Resource') + (e.group ? ' · ' + e.group : '');
  }
  function wikiHref(id) { return '../wiki/index.html#/e/' + id; }

  // ── desktop board ────────────────────────────────────────────────────────
  function renderBoard() {
    var board = $('board');
    var h = '<svg class="wires" id="wires" aria-hidden="true"></svg>';
    COLS.forEach(function (col, ci) {
      h += '<div class="col" data-col="' + ci + '"><div class="col-head"><span class="col-dot"></span>' + esc(col.label) + '</div>';
      var last = undefined;
      NODES.forEach(function (id) {
        if (COL_OF[id] !== ci) return;
        var g = GROUP_OF[id];
        if (g !== last) {
          if (last !== undefined) h += '</div>';
          h += '<div class="grp">' + (g ? '<div class="grp-label">' + esc(g) + '</div>' : '');
          last = g;
        }
        var e = E[id];
        h += '<button class="node" type="button" data-id="' + esc(id) + '" title="' + esc(e.name) + '">' + icon(e) +
          '<span class="nm">' + esc(e.name) + '</span></button>';
      });
      if (last !== undefined) h += '</div>';
      h += '</div>';
    });
    board.innerHTML = h;
    Array.prototype.forEach.call(board.querySelectorAll('.node'), function (el) { CARD[el.dataset.id] = el; });

    var svg = $('wires');
    WIRE = EDGES.map(function (ed) {
      var p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('class', 'w');
      svg.appendChild(p);
      return { from: ed[0], to: ed[1], el: p };
    });

    board.addEventListener('pointerover', function (ev) {
      var n = ev.target.closest('.node');
      if (!n || ev.pointerType === 'touch') return;
      state.hover = n.dataset.id; paint();
    });
    board.addEventListener('pointerout', function (ev) {
      var n = ev.target.closest('.node');
      if (!n || ev.pointerType === 'touch') return;
      if (ev.relatedTarget && n.contains(ev.relatedTarget)) return;
      state.hover = null; paint();
    });
    board.addEventListener('click', function (ev) {
      var n = ev.target.closest('.node');
      if (!n) return;
      focus(state.focus === n.dataset.id && !isSheet() ? null : n.dataset.id, { open: true });
    });
    board.addEventListener('focusin', function (ev) {
      var n = ev.target.closest('.node');
      if (n && n.matches(':focus-visible')) { state.hover = n.dataset.id; paint(); }
    });
    board.addEventListener('focusout', function () { state.hover = null; paint(); });
  }

  // Wires run from the right edge of the input card to the left edge of the
  // output card. Two cards in one column get an arc on the right side.
  function drawWires() {
    var board = $('board');
    if (!board.offsetWidth) return;
    var svg = $('wires');
    var br = board.getBoundingClientRect();
    svg.setAttribute('width', board.scrollWidth);
    svg.setAttribute('height', board.scrollHeight);
    var box = {};
    NODES.forEach(function (id) {
      var r = CARD[id].getBoundingClientRect();
      box[id] = { l: r.left - br.left, r: r.right - br.left, y: r.top - br.top + r.height / 2 };
    });
    WIRE.forEach(function (w) {
      var a = box[w.from], b = box[w.to], d;
      if (COL_OF[w.from] === COL_OF[w.to]) {
        var bulge = 22 + Math.min(60, Math.abs(b.y - a.y) * 0.18);
        d = 'M' + a.r + ',' + a.y + ' C' + (a.r + bulge) + ',' + a.y + ' ' + (b.r + bulge) + ',' + b.y + ' ' + b.r + ',' + b.y;
      } else {
        var dx = Math.max(40, (b.l - a.r) * 0.5);
        d = 'M' + a.r + ',' + a.y + ' C' + (a.r + dx) + ',' + a.y + ' ' + (b.l - dx) + ',' + b.y + ' ' + b.l + ',' + b.y;
      }
      w.el.setAttribute('d', d);
    });
  }

  // ── phone list ───────────────────────────────────────────────────────────
  function renderPhone() {
    var t = '';
    COLS.forEach(function (col, ci) {
      t += '<button class="tab" type="button" role="tab" data-tab="' + ci + '"><span>' + esc(col.label) + '</span><i class="tab-mark"></i></button>';
    });
    $('tabs').innerHTML = t;
    $('tabs').addEventListener('click', function (ev) {
      var b = ev.target.closest('.tab');
      if (!b) return;
      state.tab = +b.dataset.tab;
      renderList();
      paint();
    });
    $('list').addEventListener('click', function (ev) {
      var r = ev.target.closest('.row');
      if (r) focus(r.dataset.id, { open: true });
    });
    renderList();
  }

  function renderList() {
    var h = '', last;
    NODES.forEach(function (id) {
      if (COL_OF[id] !== state.tab) return;
      var e = E[id], g = GROUP_OF[id];
      if (g !== last) {
        if (last !== undefined) h += '</div>';
        h += '<div class="lgrp">' + (g ? '<div class="list-grp">' + esc(g) + '</div>' : '');
        last = g;
      }
      var ins = UP[id].map(function (m) { return icon(E[m], 'mini'); }).join('');
      h += '<button class="row" type="button" data-id="' + esc(id) + '">' + icon(e) +
        '<span class="row-main"><span class="nm">' + esc(e.name) + '</span>' +
        (ins ? '<span class="row-ins"><span class="row-cap">from</span>' + ins + '</span>' : '<span class="row-cap">' + esc(kindLabel(e)) + '</span>') +
        '</span><span class="sym">' + esc(symbolOf(e)) + '</span></button>';
    });
    if (last !== undefined) h += '</div>';
    $('list').innerHTML = h;
    if (state.query) applySearch();
    var on = document.querySelector('#tabs .tab[data-tab="' + state.tab + '"]');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  // ── focus and paint ──────────────────────────────────────────────────────
  function focus(id, opt) {
    state.focus = id;
    if (id && opt && opt.tab !== false) state.tab = COL_OF[id];
    if (isNarrow()) renderList();
    paint();
    renderPanel();
    $('clear').hidden = !id;
    try { history.replaceState(null, '', id ? '#' + id : location.pathname + location.search); } catch (e) {}
    if (id && opt && opt.open && isSheet()) openSheet();
    if (id && opt && opt.scroll && CARD[id] && !isNarrow()) {
      CARD[id].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }

  function paint() {
    var id = state.hover || state.focus;
    var up = id ? closure(id, UP) : {}, down = id ? closure(id, DOWN) : {};
    document.body.classList.toggle('has-focus', !!id);
    NODES.forEach(function (n) {
      var c = CARD[n];
      c.classList.toggle('is-focus', n === id);
      c.classList.toggle('is-up', !!up[n]);
      c.classList.toggle('is-down', !!down[n]);
      c.classList.toggle('is-pinned', n === state.focus);
    });
    WIRE.forEach(function (w) {
      var isUp = id && up[w.from] && (up[w.to] || w.to === id);
      var isDown = id && down[w.to] && (down[w.from] || w.from === id);
      w.el.setAttribute('class', 'w' + (isUp ? ' up' : '') + (isDown ? ' down' : ''));
    });
    // Phone rows and tab marks follow the pinned focus only.
    var f = state.focus, fu = f ? closure(f, UP) : {}, fd = f ? closure(f, DOWN) : {};
    Array.prototype.forEach.call(document.querySelectorAll('#list .row'), function (r) {
      var rid = r.dataset.id;
      r.classList.toggle('is-focus', rid === f);
      r.classList.toggle('is-up', !!fu[rid]);
      r.classList.toggle('is-down', !!fd[rid]);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (t) {
      var ci = +t.dataset.tab, hit = '';
      NODES.forEach(function (n) {
        if (COL_OF[n] !== ci) return;
        if (n === f) hit = 'focus';
        else if (!hit && fu[n]) hit = 'up';
        else if (!hit && fd[n]) hit = 'down';
      });
      t.dataset.mark = hit;
      t.classList.toggle('on', ci === state.tab);
      t.setAttribute('aria-selected', ci === state.tab ? 'true' : 'false');
    });
  }

  // ── detail panel ─────────────────────────────────────────────────────────
  function chips(ids, empty) {
    if (!ids.length) return '<p class="none">' + esc(empty) + '</p>';
    return '<div class="chips">' + ids.map(function (id) {
      var e = E[id], live = COL_OF[id] !== undefined;
      return '<button class="chip' + (live ? '' : ' flat') + '" type="button" data-go="' + esc(id) + '">' + icon(e, 'mini') + '<span>' + esc(e.name) + '</span></button>';
    }).join('') + '</div>';
  }

  // The need tree lists every input down to raw ore, without quantities.
  // A subtree that already showed once collapses to a back reference.
  function needTree(id, seen, depth) {
    var kids = UP[id] || [];
    if (!kids.length) return '';
    // Mark every child before the recursion, so an item expands at its
    // shallowest place in the tree and repeats lower down.
    var again = kids.map(function (k) { return !!seen[k]; });
    kids.forEach(function (k) { seen[k] = true; });
    var h = '<ul class="tree">';
    kids.forEach(function (k, i) {
      var e = E[k];
      var sub = again[i] ? '' : needTree(k, seen, depth + 1);
      h += '<li>' + (sub ? '<details' + (depth < 1 ? ' open' : '') + '><summary>' : '<div class="leaf">') +
        icon(e, 'mini') + '<span class="tn">' + esc(e.name) + '</span>' +
        (again[i] && (UP[k] || []).length ? '<span class="tag">repeat</span>' : '') +
        (!(UP[k] || []).length ? '<span class="tag raw">' + esc(e.tier || '') + '</span>' : '') +
        (sub ? '</summary>' + sub + '</details>' : '</div>') + '</li>';
    });
    return h + '</ul>';
  }

  function chainList(id) {
    var up = closure(id, UP), down = closure(id, DOWN), h = '';
    COLS.forEach(function (col, ci) {
      var ids = NODES.filter(function (n) { return COL_OF[n] === ci && (up[n] || down[n] || n === id); });
      if (!ids.length) return;
      h += '<div class="ch-row"><div class="ch-col">' + esc(col.label) + '</div><div class="chips">' +
        ids.map(function (n) {
          var k = n === id ? 'focus' : up[n] ? 'up' : 'down';
          return '<button class="chip ' + k + '" type="button" data-go="' + esc(n) + '">' + icon(E[n], 'mini') + '<span>' + esc(E[n].name) + '</span></button>';
        }).join('') + '</div></div>';
    });
    return h;
  }

  function renderPanel() {
    var p = $('panel'), id = state.focus;
    if (!id) {
      p.innerHTML = '<div class="empty"><div class="empty-orb"><span></span></div>' +
        '<h2>Pick an item</h2><p>Hover or tap any card to trace its chain. Gold wires show what it takes. Blue wires show what it feeds.</p>' +
        '<p class="keys"><kbd>/</kbd> search <kbd>Esc</kbd> clear</p></div>';
      return;
    }
    var e = E[id];
    var ins = UP[id];
    var outs = DOWN[id].filter(function (n) { return E[n].category === 'resources'; });
    var mods = DOWN[id].filter(function (n) { return E[n].category === 'modules'; });
    var up = closure(id, UP);
    var ores = NODES.filter(function (n) { return up[n] && !UP[n].length; });
    var sprites = e.sprites || [];
    var h = '<div class="sheet-grip" aria-hidden="true"></div>' +
      '<button class="x" type="button" id="closePanel" aria-label="Close">&times;</button>' +
      '<div class="p-head"><div class="p-art">' +
      (e.sprite ? '<img id="pImg" src="' + esc(src(e.sprite)) + '" alt="' + esc(e.name) + '">' : '<span class="glyph big">' + esc(symbolOf(e)) + '</span>') +
      '</div><div class="p-id"><div class="kicker">' + esc(kindLabel(e)) + '</div><h2>' + esc(e.name) + '</h2>' +
      '<span class="pill">' + esc(symbolOf(e)) + '</span></div></div>';
    if (sprites.length > 1) {
      h += '<div class="variants">' + sprites.map(function (s, i) {
        return '<button type="button" class="var' + (i ? '' : ' on') + '" data-src="' + esc(src(s)) + '" aria-label="Variant ' + (i + 1) + '"><img src="' + esc(src(s)) + '" alt="" loading="lazy"></button>';
      }).join('') + '</div>';
    }
    h += '<section><h3>Made from</h3>' + chips(ins, e.category === 'resources' && e.tier === 'Ores' ? 'Mined from asteroids. A raw ore has no inputs.' : 'No crafted inputs.') + '</section>';
    if (e.category === 'resources') {
      h += '<section><h3>Used in</h3>' + chips(outs, 'Not an input to another resource.') + '</section>';
      h += '<section><h3>Builds</h3>' + chips(mods, 'Not a build material for a station module.') + '</section>';
    }
    h += '<section><h3>Unlocked by</h3>' + chips(e.links.unlockedBy, 'Available from the start.') + '</section>';
    if (ins.length) {
      h += '<section><h3>What you need</h3><p class="sub">Every input, down to raw ore. No amounts.</p>' + needTree(id, {}, 0) + '</section>';
      h += '<section><h3>Raw ores in the chain</h3>' + chips(ores, '') + '</section>';
    }
    h += '<section><h3>Full chain</h3>' + chainList(id) + '</section>';
    h += '<a class="wiki" href="' + esc(wikiHref(id)) + '">Open in the wiki <span aria-hidden="true">&rarr;</span></a>';
    p.innerHTML = h;
    p.scrollTop = 0;
  }

  function onPanelClick(ev) {
    var go = ev.target.closest('[data-go]');
    if (go) {
      var gid = go.dataset.go;
      if (COL_OF[gid] !== undefined) { ev.preventDefault(); focus(gid, { scroll: true }); }
      else location.href = wikiHref(gid);
      return;
    }
    var v = ev.target.closest('.var');
    if (v) {
      $('pImg').src = v.dataset.src;
      Array.prototype.forEach.call(document.querySelectorAll('.var'), function (b) { b.classList.toggle('on', b === v); });
      return;
    }
    if (ev.target.closest('#closePanel')) closeSheet();
  }

  // ── bottom sheet (narrow screens) ────────────────────────────────────────
  function openSheet() {
    document.body.classList.add('sheet-open');
    $('scrim').hidden = false;
  }
  function closeSheet() {
    document.body.classList.remove('sheet-open');
    $('scrim').hidden = true;
  }

  // ── search ───────────────────────────────────────────────────────────────
  function matches(id, q) {
    var e = E[id];
    return e.name.toLowerCase().indexOf(q) >= 0 || symbolOf(e).toLowerCase() === q ||
      (e.tier || '').toLowerCase().indexOf(q) >= 0 || (e.group || '').toLowerCase().indexOf(q) >= 0;
  }
  function applySearch() {
    var q = state.query.trim().toLowerCase();
    document.body.classList.toggle('searching', !!q);
    var first = null, perCol = {};
    NODES.forEach(function (id) {
      var hit = !!q && matches(id, q);
      CARD[id].classList.toggle('hit', hit);
      if (hit) { if (!first) first = id; perCol[COL_OF[id]] = true; }
    });
    Array.prototype.forEach.call(document.querySelectorAll('#list .row'), function (r) {
      r.hidden = !!q && !matches(r.dataset.id, q);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#list .lgrp'), function (g) {
      g.hidden = !g.querySelector('.row:not([hidden])');
    });
    if (q && isNarrow() && !perCol[state.tab] && first) {
      state.tab = COL_OF[first]; renderList(); paint();
    }
    return first;
  }

  // ── boot ─────────────────────────────────────────────────────────────────
  function boot() {
    if (!D || !D.entries) {
      $('panel').innerHTML = '<div class="empty"><h2>Catalog missing</h2><p>The game catalog did not load.</p></div>';
      return;
    }
    buildGraph();
    renderBoard();
    renderPhone();
    renderPanel();
    paint();

    $('panel').addEventListener('click', onPanelClick);
    $('scrim').addEventListener('click', closeSheet);
    $('clear').addEventListener('click', function () { focus(null); });
    var q = $('q');
    q.addEventListener('input', function () { state.query = q.value; applySearch(); });
    q.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        var f = applySearch();
        if (f) { focus(f, { scroll: true, open: true }); q.blur(); }
      } else if (ev.key === 'Escape') {
        q.value = ''; state.query = ''; applySearch(); q.blur();
      }
    });
    document.addEventListener('keydown', function (ev) {
      var typing = /INPUT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName);
      if (ev.key === '/' && !typing) { ev.preventDefault(); q.focus(); }
      else if (ev.key === 'Escape' && !typing) {
        if (document.body.classList.contains('sheet-open')) closeSheet();
        else focus(null);
      }
    });

    // The sheet grip closes the sheet on a downward drag.
    var y0 = null;
    $('panel').addEventListener('pointerdown', function (ev) {
      if (ev.target.closest('.sheet-grip')) y0 = ev.clientY;
    });
    window.addEventListener('pointerup', function (ev) {
      if (y0 !== null && ev.clientY - y0 > 40) closeSheet();
      y0 = null;
    });

    var redraw = function () { requestAnimationFrame(drawWires); };
    if (window.ResizeObserver) new ResizeObserver(redraw).observe($('board'));
    window.addEventListener('resize', function () {
      redraw();
      if (!isSheet()) closeSheet();
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw);
    window.addEventListener('load', redraw);
    redraw();

    var h = decodeURIComponent((location.hash || '').replace(/^#/, ''));
    if (h && COL_OF[h] !== undefined) focus(h, { scroll: true });
  }

  boot();
})();
