// ============================================================================
//  RESEARCH  ·  main.js — tech tree board, search and selection panel
// ----------------------------------------------------------------------------
//  A classic script. It reads window.SN_DATA (lib/game-data/catalog.js) and
//  draws every research entry as a node card on one board.
//
//  LAYOUT
//    Lanes are disciplines (entry.group). Columns are tier labels
//    ('Tier 0' .. 'Tier 10'). The script stacks the nodes of one lane and
//    one tier in a cell. A few sweeps sort each cell by the mean height of
//    the prerequisites, so that fewer lines cross. Lines go from the right
//    edge of a prerequisite to the left edge of the node that needs it.
//
//  SELECTION
//    A selected node marks its full prerequisite set (walk unlockedBy) in
//    gold and every research it leads to (walk research ids in unlocks) in
//    blue. The panel lists the path, the items it unlocks and a wiki link.
//    The hash (#research/<slug>) holds the selection, so a link can open it.
//
//  The script shows names, tier labels and links only. It holds no costs
//  and no numbers from the game.
//
//  grep -n targets
//    config ............. "var CFG"
//    data model ......... "function buildModel"
//    layout ............. "function layout"
//    render board ....... "function renderBoard"
//    edges .............. "function renderEdges"
//    view transform ..... "function apply"
//    fit and centre ..... "function fit" / "function centerOn"
//    pointer input ...... "function bindPointer"
//    selection .......... "function select"
//    panel .............. "function renderPanel"
//    search ............. "function runSearch"
//    boot ............... "function boot"
// ============================================================================
(function () {
  'use strict';

  var CFG = {
    WIKI: '../wiki/index.html#/e/',  // wiki entry link prefix, then the entry id
    ROOT: '../../',                  // sprite paths are relative to stella-nova/
    NODE_W: 196, NODE_H: 74,
    COL_W: 250, ROW_H: 96,
    LEFT: 36, HEAD_H: 46,
    LANE_TOP: 46, LANE_BOT: 24, LANE_GAP: 26,
    MIN_S: 0.22, MAX_S: 2.2,
    LANES: ['Materials', 'Combat', 'Antimatter'],
    COLORS: { Materials: 'var(--c-materials)', Combat: 'var(--c-combat)', Antimatter: 'var(--c-antimatter)' }
  };

  var D = window.SN_DATA;
  var byId = {};
  var nodes = [];          // research entries with layout fields
  var nodeById = {};
  var tiers = [];          // sorted tier labels in use
  var lanes = [];          // { name, top, height }
  var worldW = 0, worldH = 0;
  var view, world, edgesSvg, panel, panelBody, qInput, hitsList;
  var T = { x: 0, y: 0, s: 1 };
  var selected = null;
  var edgeEls = [];

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function tierIndex(label) { var m = /(\d+)/.exec(label || ''); return m ? parseInt(m[1], 10) : 0; }
  function initials(name) { return name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); }
  function laneColor(n) { return CFG.COLORS[n.lane] || 'var(--blue)'; }

  // ── data model ────────────────────────────────────────────────────────────
  function buildModel() {
    D.entries.forEach(function (e) { byId[e.id] = e; });
    nodes = D.entries.filter(function (e) { return e.category === 'research'; }).map(function (e, i) {
      var unlocks = e.links.unlocks || [];
      return {
        e: e, id: e.id, name: e.name, order: i,
        lane: e.group || (e.fields && e.fields.Discipline) || 'Materials',
        tierLabel: e.tier || 'Tier 0', t: tierIndex(e.tier),
        pre: (e.links.unlockedBy || []).filter(function (id) { return id.indexOf('research/') === 0; }),
        next: unlocks.filter(function (id) { return id.indexOf('research/') === 0; }),
        grants: unlocks.filter(function (id) { return id.indexOf('research/') !== 0 && byId[id]; }),
        x: 0, y: 0
      };
    });
    nodes.forEach(function (n) { nodeById[n.id] = n; });
    nodes.forEach(function (n) {
      n.pre = n.pre.filter(function (id) { return nodeById[id]; });
      n.next = n.next.filter(function (id) { return nodeById[id]; });
    });
    var seen = {};
    nodes.forEach(function (n) { if (!seen[n.tierLabel]) { seen[n.tierLabel] = 1; tiers.push(n.tierLabel); } });
    tiers.sort(function (a, b) { return tierIndex(a) - tierIndex(b); });
    // Unknown disciplines get their own lane after the known ones.
    nodes.forEach(function (n) { if (CFG.LANES.indexOf(n.lane) < 0) CFG.LANES.push(n.lane); });
  }

  // ── layout ────────────────────────────────────────────────────────────────
  function layout() {
    var col = {};
    tiers.forEach(function (t, i) { col[t] = i; });
    var cells = {};
    nodes.forEach(function (n) {
      n.col = col[n.tierLabel];
      var k = n.lane + '|' + n.col;
      (cells[k] = cells[k] || []).push(n);
    });
    function place() {
      var top = CFG.HEAD_H;
      lanes = [];
      CFG.LANES.forEach(function (lane) {
        var rows = 0;
        tiers.forEach(function (t, c) { var a = cells[lane + '|' + c]; if (a && a.length > rows) rows = a.length; });
        if (!rows) return;
        var h = CFG.LANE_TOP + rows * CFG.ROW_H - (CFG.ROW_H - CFG.NODE_H) + CFG.LANE_BOT;
        tiers.forEach(function (t, c) {
          var a = cells[lane + '|' + c];
          if (!a) return;
          var off = (rows - a.length) / 2;
          a.forEach(function (n, i) {
            n.x = CFG.LEFT + c * CFG.COL_W;
            n.y = top + CFG.LANE_TOP + (off + i) * CFG.ROW_H;
          });
        });
        lanes.push({ name: lane, top: top, height: h });
        top += h + CFG.LANE_GAP;
      });
      worldW = CFG.LEFT * 2 + (tiers.length - 1) * CFG.COL_W + CFG.NODE_W;
      worldH = top - CFG.LANE_GAP + 10;
    }
    function mean(ids, fallback) {
      if (!ids.length) return fallback;
      var s = 0;
      ids.forEach(function (id) { s += nodeById[id].y; });
      return s / ids.length;
    }
    place();
    // Barycentre sweeps: forward on prerequisites, backward on dependents.
    for (var pass = 0; pass < 6; pass++) {
      var fwd = pass % 2 === 0;
      Object.keys(cells).forEach(function (k) {
        var a = cells[k];
        a.forEach(function (n) { n.key = mean(fwd ? n.pre : n.next, n.y); });
        a.sort(function (p, q) { return (p.key - q.key) || (p.order - q.order); });
      });
      place();
    }
  }

  // ── render board ──────────────────────────────────────────────────────────
  function chipHtml(id, size) {
    var e = byId[id];
    var mod = e.category === 'modules' ? ' mod' : '';
    var inner = e.sprite
      ? '<img src="' + esc(CFG.ROOT + e.sprite) + '" alt="" loading="lazy" decoding="async">'
      : '<b>' + esc((e.fields && e.fields.Symbol && e.category === 'resources') ? e.fields.Symbol : initials(e.name)) + '</b>';
    return '<span class="chip' + mod + '" title="' + esc(e.name) + '"' + (size ? ' style="width:' + size + 'px;height:' + size + 'px"' : '') + '>' + inner + '</span>';
  }

  function renderBoard() {
    world.style.width = worldW + 'px';
    world.style.height = worldH + 'px';
    edgesSvg.setAttribute('width', worldW);
    edgesSvg.setAttribute('height', worldH);
    var frag = document.createDocumentFragment();
    lanes.forEach(function (L) {
      var b = el('div', 'lane');
      b.style.cssText = 'left:' + (CFG.LEFT - 18) + 'px;top:' + L.top + 'px;width:' + (worldW - 2 * CFG.LEFT + 36) + 'px;height:' + L.height + 'px;--c:' + (CFG.COLORS[L.name] || 'var(--blue)');
      b.appendChild(el('span', 'lane-label', esc(L.name)));
      frag.appendChild(b);
    });
    tiers.forEach(function (t, c) {
      var h = el('div', 'tier-head', esc(t));
      h.style.left = (CFG.LEFT + c * CFG.COL_W) + 'px';
      h.style.top = '6px';
      frag.appendChild(h);
    });
    nodes.forEach(function (n) {
      var b = el('button', 'node');
      b.type = 'button';
      b.dataset.id = n.id;
      b.style.cssText = 'left:' + n.x + 'px;top:' + n.y + 'px;--c:' + laneColor(n);
      var chips = '';
      if (n.grants.length) {
        n.grants.slice(0, 5).forEach(function (id) { chips += chipHtml(id); });
        if (n.grants.length > 5) chips += '<span class="n-more">+' + (n.grants.length - 5) + '</span>';
      } else {
        chips = '<span class="n-lead">' + (n.next.length ? 'Opens research' : 'Final node') + '</span>';
      }
      b.innerHTML = '<span class="n-name">' + esc(n.name) + '</span><span class="n-chips">' + chips + '</span>';
      b.setAttribute('aria-label', n.name + ', ' + n.lane + ', ' + n.tierLabel);
      n.el = b;
      frag.appendChild(b);
    });
    world.appendChild(frag);
    renderEdges();
  }

  function renderEdges() {
    var NS = 'http://www.w3.org/2000/svg';
    edgeEls = [];
    nodes.forEach(function (n) {
      n.pre.forEach(function (pid) {
        var p = nodeById[pid];
        var x1 = p.x + CFG.NODE_W, y1 = p.y + CFG.NODE_H / 2;
        var x2 = n.x, y2 = n.y + CFG.NODE_H / 2;
        var dx = Math.max(36, (x2 - x1) * 0.5);
        var path = document.createElementNS(NS, 'path');
        path.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2);
        if (p.lane !== n.lane) path.setAttribute('class', 'cross');
        edgesSvg.appendChild(path);
        edgeEls.push({ from: p, to: n, el: path, cross: p.lane !== n.lane });
      });
    });
  }

  // ── view transform ────────────────────────────────────────────────────────
  function apply() {
    world.style.transform = 'translate(' + T.x + 'px,' + T.y + 'px) scale(' + T.s + ')';
  }
  function clampS(s) { return Math.max(CFG.MIN_S, Math.min(CFG.MAX_S, s)); }
  function zoomAt(cx, cy, f) {
    var s = clampS(T.s * f);
    var k = s / T.s;
    T.x = cx - (cx - T.x) * k;
    T.y = cy - (cy - T.y) * k;
    T.s = s;
    apply();
  }
  function isPhone() { return window.matchMedia('(max-width: 760px)').matches; }
  // The free part of the viewport: on a wide screen the panel covers the right side.
  function freeRect() {
    var w = view.clientWidth, h = view.clientHeight;
    if (!isPhone() && panel.offsetWidth) w -= panel.offsetWidth + 34;
    else if (isPhone() && panel.classList.contains('open')) h -= panel.offsetHeight;
    return { w: Math.max(120, w), h: Math.max(120, h) };
  }
  var anim = 0;
  function tween(to, ms) {
    var from = { x: T.x, y: T.y, s: T.s };
    var t0 = performance.now();
    var id = ++anim;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) ms = 0;
    function step(now) {
      if (id !== anim) return;
      var u = ms ? Math.min(1, (now - t0) / ms) : 1;
      var k = 1 - Math.pow(1 - u, 3);
      T.x = from.x + (to.x - from.x) * k;
      T.y = from.y + (to.y - from.y) * k;
      T.s = from.s + (to.s - from.s) * k;
      apply();
      if (u < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function fit(animate) {
    var r = freeRect();
    var s = clampS(Math.min((r.w - 32) / worldW, (r.h - 32) / worldH));
    var to = { s: s, x: (r.w - worldW * s) / 2, y: Math.max(12, (r.h - worldH * s) / 2) };
    if (animate) tween(to, 420); else { T = to; apply(); }
  }
  // Start view: the whole tree when it is legible, otherwise the root end of
  // the tree at a legible scale.
  function home() {
    var r = freeRect();
    var fs = Math.min((r.w - 32) / worldW, (r.h - 32) / worldH);
    var s = isPhone() ? 0.6 : 0.62;
    if (fs >= s) { fit(false); return; }
    T = { s: s, x: 12, y: Math.max(12, (r.h - worldH * s) / 2) };
    if (isPhone()) T.y = 12;
    apply();
  }
  function centerOn(n) {
    var r = freeRect();
    var s = Math.max(T.s, isPhone() ? 0.7 : 0.85);
    s = clampS(s);
    tween({ s: s, x: r.w / 2 - (n.x + CFG.NODE_W / 2) * s, y: r.h / 2 - (n.y + CFG.NODE_H / 2) * s }, 420);
  }

  // ── pointer input ─────────────────────────────────────────────────────────
  var moved = 0;
  function bindPointer() {
    var pts = new Map();
    var last = null;
    function mid() {
      var a = Array.from(pts.values());
      if (a.length === 1) return { x: a[0].x, y: a[0].y, d: 0 };
      return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) };
    }
    function local(e) { var r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    view.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      anim++;
      if (pts.size === 0) moved = 0;
      pts.set(e.pointerId, local(e));
      last = mid();
      view.classList.add('drag');
      hideHint();
    });
    window.addEventListener('pointermove', function (e) {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, local(e));
      var m = mid();
      if (pts.size >= 2 && last && last.d > 0) {
        var k = m.d / last.d;
        T.x += m.x - last.x; T.y += m.y - last.y;
        zoomAt(m.x, m.y, k);
        moved += 10;
      } else {
        T.x += m.x - last.x; T.y += m.y - last.y;
        moved += Math.abs(m.x - last.x) + Math.abs(m.y - last.y);
        apply();
      }
      last = m;
    });
    function up(e) {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      last = pts.size ? mid() : null;
      if (!pts.size) view.classList.remove('drag');
    }
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    view.addEventListener('wheel', function (e) {
      e.preventDefault();
      anim++;
      var r = view.getBoundingClientRect();
      var k = e.ctrlKey ? 0.012 : 0.0016;
      var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-dy * k));
      hideHint();
    }, { passive: false });
    // Safari trackpad pinch
    view.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    view.addEventListener('click', function (e) {
      var b = e.target.closest('.node');
      if (!b || moved > 8) return;
      select(nodeById[b.dataset.id], true);
    });
    view.addEventListener('keydown', function (e) {
      var b = e.target.closest && e.target.closest('.node');
      if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(nodeById[b.dataset.id], true); }
    });
    // A node that gets keyboard focus comes into view.
    view.addEventListener('focusin', function (e) {
      var b = e.target.closest('.node');
      if (!b || pts.size) return;
      var n = nodeById[b.dataset.id];
      var r = freeRect();
      var sx = T.x + n.x * T.s, sy = T.y + n.y * T.s;
      if (sx < 0 || sy < 0 || sx + CFG.NODE_W * T.s > r.w || sy + CFG.NODE_H * T.s > r.h) centerOn(n);
    });
  }
  function hideHint() { var h = document.getElementById('hint'); if (h) h.classList.add('gone'); }

  // ── selection ─────────────────────────────────────────────────────────────
  function walk(start, key) {
    var out = {}, stack = start[key].slice();
    while (stack.length) {
      var id = stack.pop();
      if (out[id]) continue;
      out[id] = 1;
      stack.push.apply(stack, nodeById[id][key]);
    }
    return out;
  }
  function select(n, focusView) {
    selected = n || null;
    document.body.classList.toggle('has-sel', !!n);
    view.classList.toggle('has-sel', !!n);
    var anc = n ? walk(n, 'pre') : {};
    var desc = n ? walk(n, 'next') : {};
    nodes.forEach(function (m) {
      m.el.classList.toggle('sel', m === n);
      m.el.classList.toggle('anc', !!anc[m.id]);
      m.el.classList.toggle('desc', !!desc[m.id]);
    });
    edgeEls.forEach(function (E) {
      var up = n && anc[E.from.id] && (anc[E.to.id] || E.to === n);
      var down = n && desc[E.to.id] && (desc[E.from.id] || E.from === n);
      E.el.setAttribute('class', (E.cross ? 'cross ' : '') + (up ? 'up' : down ? 'down' : ''));
    });
    renderPanel(n, anc, desc);
    if (n) hideHint();
    try { history.replaceState(null, '', n ? '#' + n.id : location.pathname + location.search); } catch (e) { /* file:// may refuse */ }
    if (n && focusView) centerOn(n);
  }

  // ── panel ─────────────────────────────────────────────────────────────────
  function pill(id) {
    var e = byId[id];
    if (e.category === 'research') {
      var n = nodeById[id];
      return '<button type="button" class="p-pill" data-go="' + esc(id) + '" style="--c:' + laneColor(n) + '"><i></i>' + esc(e.name) + '</button>';
    }
    return '<a class="p-pill" href="' + esc(CFG.WIKI + id) + '">' + chipHtml(id, 22) + esc(e.name) + '</a>';
  }
  function list(ids, none) {
    if (!ids.length) return '<p class="p-none">' + none + '</p>';
    return '<div class="p-list">' + ids.map(pill).join('') + '</div>';
  }
  function byTier(set) {
    return Object.keys(set).map(function (id) { return nodeById[id]; })
      .sort(function (a, b) { return (a.t - b.t) || (a.y - b.y); })
      .map(function (m) { return m.id; });
  }
  function renderPanel(n, anc, desc) {
    if (!n) {
      panel.classList.add('empty');
      panel.classList.remove('open', 'full');
      document.body.classList.remove('sheet-open');
      panel.style.removeProperty('--c');
      panelBody.innerHTML =
        '<div class="p-kicker"><i style="background:var(--gold)"></i>How to read the tree</div>' +
        '<h2 class="p-name">Every research node</h2>' +
        '<p class="p-intro">Rows are <b>disciplines</b>, columns are <b>tiers</b>. Small chips on a card are the items it unlocks. Select a node to trace its path.</p>' +
        '<div class="p-key">' +
        '<div><s style="--k:var(--gold)"></s>Prerequisite path</div>' +
        '<div><s style="--k:var(--blue)"></s>Research it leads to</div>' +
        '<div><s class="dash" style="--k:rgba(150,200,255,.5)"></s>Link across disciplines</div>' +
        '</div>';
      return;
    }
    panel.classList.remove('empty');
    panel.classList.add('open');
    panel.style.setProperty('--c', laneColor(n));
    panelBody.innerHTML =
      '<div class="p-kicker"><i></i>' + esc(n.lane) + ' · ' + esc(n.tierLabel) + '</div>' +
      '<h2 class="p-name">' + esc(n.name) + '</h2>' +
      '<div class="p-sec"><h3>Unlocks</h3>' + list(n.grants, 'No items. This node opens research only.') + '</div>' +
      '<div class="p-sec"><h3>Needs</h3>' + list(n.pre, 'Nothing. This is a root node.') + '</div>' +
      '<div class="p-sec"><h3>Full prerequisite path</h3>' + list(byTier(anc), 'Nothing.') + '</div>' +
      '<div class="p-sec"><h3>Leads to</h3>' + list(n.next, 'Nothing. This is a final node.') + '</div>' +
      (Object.keys(desc).length > n.next.length ? '<div class="p-sec"><h3>Everything after it</h3>' + list(byTier(desc), '') + '</div>' : '') +
      '<div class="p-notes" data-notes="' + esc(n.id) + '"></div>' +
      '<div class="p-actions"><a class="p-btn gold" href="' + esc(CFG.WIKI + n.id) + '">Open in wiki</a>' +
      '<button type="button" class="p-btn" data-act="clear">Clear</button></div>';
    panel.scrollTop = 0;
    syncSheet();
  }
  function syncSheet() {
    var open = isPhone() && panel.classList.contains('open');
    document.body.classList.toggle('sheet-open', open);
    if (open) document.body.style.setProperty('--sheet-h', panel.offsetHeight + 'px');
  }

  // ── search ────────────────────────────────────────────────────────────────
  var hits = [], hitIdx = -1;
  function runSearch() {
    var q = qInput.value.trim().toLowerCase();
    nodes.forEach(function (n) { n.el.classList.remove('hit'); });
    view.classList.toggle('has-q', !!q);
    hits = [];
    if (!q) { hitsList.hidden = true; return; }
    nodes.forEach(function (n) {
      if (n.name.toLowerCase().indexOf(q) >= 0 || n.lane.toLowerCase().indexOf(q) >= 0 || n.tierLabel.toLowerCase() === q) {
        hits.push({ n: n, label: n.name, sub: n.tierLabel });
        n.el.classList.add('hit');
      }
    });
    nodes.forEach(function (n) {
      n.grants.forEach(function (id) {
        var e = byId[id];
        if (e.name.toLowerCase().indexOf(q) >= 0) {
          hits.push({ n: n, label: e.name, sub: 'from ' + n.name });
          n.el.classList.add('hit');
        }
      });
    });
    hitIdx = hits.length ? 0 : -1;
    drawHits();
  }
  function drawHits() {
    hitsList.hidden = false;
    if (!hits.length) { hitsList.innerHTML = '<li class="empty">No match</li>'; return; }
    hitsList.innerHTML = hits.slice(0, 14).map(function (h, i) {
      return '<li><button type="button" role="option" data-i="' + i + '" class="' + (i === hitIdx ? 'on' : '') + '" style="--c:' + laneColor(h.n) + '">' +
        '<span class="h-dot"></span><span class="h-name">' + esc(h.label) + '</span><span class="h-sub">' + esc(h.sub) + '</span></button></li>';
    }).join('');
  }
  function pickHit(i) {
    var h = hits[i];
    if (!h) return;
    hitsList.hidden = true;
    qInput.blur();
    select(h.n, true);
  }

  // ── boot ──────────────────────────────────────────────────────────────────
  function boot() {
    view = document.getElementById('view');
    world = document.getElementById('world');
    edgesSvg = document.getElementById('edges');
    panel = document.getElementById('panel');
    panelBody = document.getElementById('panel-body');
    qInput = document.getElementById('q');
    hitsList = document.getElementById('hits');
    if (!D || !D.entries) {
      panelBody.innerHTML = '<p class="p-intro">The game catalog did not load.</p>';
      return;
    }
    buildModel();
    layout();
    renderBoard();
    bindPointer();

    var legend = document.getElementById('legend');
    legend.innerHTML = lanes.map(function (L) {
      return '<span style="--c:' + (CFG.COLORS[L.name] || 'var(--blue)') + '"><i></i><b>' + esc(L.name) + '</b></span>';
    }).join('');

    document.getElementById('dock').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var r = freeRect();
      if (b.dataset.act === 'fit') fit(true);
      else if (b.dataset.act === 'in') zoomAt(r.w / 2, r.h / 2, 1.3);
      else if (b.dataset.act === 'out') zoomAt(r.w / 2, r.h / 2, 1 / 1.3);
      else if (b.dataset.act === 'clear') { select(null); qInput.value = ''; runSearch(); }
    });
    panel.addEventListener('click', function (e) {
      var go = e.target.closest('[data-go]');
      if (go) { select(nodeById[go.dataset.go], true); return; }
      if (e.target.closest('[data-act="clear"]')) select(null);
    });
    document.getElementById('grip').addEventListener('click', function () {
      panel.classList.toggle('full');
      setTimeout(syncSheet, 360);
    });

    qInput.addEventListener('input', runSearch);
    qInput.addEventListener('focus', function () { if (qInput.value.trim()) runSearch(); });
    qInput.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' && hits.length) { e.preventDefault(); hitIdx = (hitIdx + 1) % Math.min(14, hits.length); drawHits(); }
      else if (e.key === 'ArrowUp' && hits.length) { e.preventDefault(); hitIdx = (hitIdx - 1 + Math.min(14, hits.length)) % Math.min(14, hits.length); drawHits(); }
      else if (e.key === 'Enter') { e.preventDefault(); pickHit(Math.max(0, hitIdx)); }
      else if (e.key === 'Escape') { qInput.value = ''; runSearch(); qInput.blur(); }
    });
    hitsList.addEventListener('pointerdown', function (e) { e.preventDefault(); });
    hitsList.addEventListener('click', function (e) {
      var b = e.target.closest('[data-i]');
      if (b) pickHit(+b.dataset.i);
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.find')) hitsList.hidden = true;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement !== qInput) { e.preventDefault(); qInput.focus(); }
      else if (e.key === 'Escape' && document.activeElement !== qInput) select(null);
    });

    var resizeT = 0, lastW = window.innerWidth;
    window.addEventListener('resize', function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(function () {
        syncSheet();
        // A phone toolbar changes only the height. Keep the view then.
        if (!selected && window.innerWidth !== lastW) home();
        lastW = window.innerWidth;
      }, 120);
    });

    var h = decodeURIComponent((location.hash || '').replace(/^#/, ''));
    select(null);
    home();
    window.__research = { select: function (id) { select(nodeById[id] || null, true); }, view: function () { return T; } };
    if (h) {
      var n = nodeById[h] || nodeById['research/' + h];
      if (n) select(n, true);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
