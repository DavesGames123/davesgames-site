// ============================================================================
//  STATION PLANNER  ·  main.js — panels, input, file and share link
// ----------------------------------------------------------------------------
//  This classic script runs last. It fills the palette from the PL type
//  table, keeps the UI state object (window.UI) that view.js reads, and turns
//  pointer, wheel and key input into layout edits. Every edit goes through
//  PL.begin (undo point), a change, PL.commit, then changed().
//
//  INPUT  (pointer events, so mouse, pen and touch share one path)
//      two pointers ......... pinch zoom and pan, on every tool
//      middle button, Space . pan
//      select ............... tap a module to select, drag it to move,
//                             drag empty space to pan
//      build ................ walls: drag a line or a room outline;
//                             other modules: tap a cell (touch: drag the
//                             ghost, then lift to place)
//      erase ................ tap or drag over modules
//
//  KEYS   V select · B build · X erase · H pan · R rotate · Delete
//         Ctrl+Z undo · Ctrl+Shift+Z or Ctrl+Y redo · F fit · Esc cancel
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//      ui state ........... "var UI ="
//      palette ............ "function buildPalette"
//      inspector .......... "function renderInspect"
//      summary ............ "function renderSummary"
//      layers ............. "function renderLayers"
//      tools + hint ....... "function setTool"
//      after an edit ...... "function changed"
//      pointer input ...... "function onDown"
//      keys ............... "function onKey"
//      share + file ....... "function shareURL"
//      sheets (phone) ..... "function openSheet"
//      boot ............... "function boot"
//      screensaver ........ "window.snSaver"      build-up autopilot
// ============================================================================
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var WIKI = '../wiki/index.html#/e/';
  var LAYER_NAME = { hull: 'Structure', furniture: 'Furniture', turret: 'Turrets' };
  var TAG_NAME = { structural: 'Structural', furniture: 'Furniture', turret: 'Turret', thruster: 'Thruster', docking: 'Docking', interior: 'Interior', exterior: 'Exterior', directional: 'Has a facing', flag: 'Flies a flag' };
  var FACING = ['North', 'East', 'South', 'West'];

  // ---- ui state ---------------------------------------------------------------
  var UI = window.UI = {
    tool: 'select', pick: null, rot: 0, sel: 0, hoverU: 0, ghost: null, run: null, drag: null,
    visible: { hull: true, furniture: true, turret: true }, locked: { hull: false, furniture: false, turret: false },
    wallMode: 'line', space: false
  };
  var cv = $('cv'), stage = $('stage');
  // COMPACT_Q: keep this query the same as the COMPACT block in style.css.
  var COMPACT_Q = '(max-width: 760px), (pointer: coarse) and (max-height: 500px), (pointer: coarse) and (max-width: 900px) and (orientation: portrait)';
  var phone = function () { return window.matchMedia(COMPACT_Q).matches; };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function thumb(t, cls) {
    if (t.img || t.sprites.length) {
      var src = '../../' + (t.wall && t.sprites[3] ? t.sprites[3] : t.sprites[0]);
      return '<span class="' + (cls || 'th') + '"><img src="' + src + '" alt="" loading="lazy" draggable="false"></span>';
    }
    return '<span class="' + (cls || 'th') + ' sym" style="--ac:' + VW.accent(t) + '">' + esc(t.symbol) + '</span>';
  }
  function entryThumb(e) {
    if (e.sprite) return '<img src="../../' + e.sprite + '" alt="" loading="lazy">';
    return '<i>' + esc((e.fields && e.fields.Symbol) || e.name.charAt(0)) + '</i>';
  }

  // ---- palette ----------------------------------------------------------------
  function buildPalette() {
    var q = $('search').value.trim().toLowerCase(), all = $('showUnlisted').checked, html = '';
    var groups = PL.SECTIONS.slice();
    if (all) groups.push('Outside the palette');
    groups.forEach(function (g) {
      var list = PL.TYPES.filter(function (t) {
        var inG = g === 'Outside the palette' ? (!t.section && !t.core) : t.section === g;
        if (!inG) return false;
        if (!q) return true;
        return (t.name + ' ' + (t.section || '') + ' ' + t.tags.join(' ') + ' ' + t.status).toLowerCase().indexOf(q) >= 0;
      });
      if (!list.length) return;
      html += '<div class="pg"><div class="pg-h"><span>' + esc(g) + '</span><b>' + list.length + '</b></div><div class="pg-l">';
      list.forEach(function (t) {
        var io = t.entry.fields.Input && t.entry.fields.Output ? esc(t.entry.fields.Input) + ' → ' + esc(t.entry.fields.Output) : (t.layer === 'hull' ? (t.tags.indexOf('exterior') >= 0 ? 'Exterior' : (t.tags.indexOf('interior') >= 0 ? 'Interior' : LAYER_NAME[t.layer])) : LAYER_NAME[t.layer]);
        var st = t.status && t.status !== 'Buildable' ? '<em class="st">' + esc(t.status) + '</em>' : '';
        html += '<button class="pc' + (UI.pick === t.slug ? ' on' : '') + '" data-slug="' + t.slug + '" title="' + esc(t.name) + '">' + thumb(t) +
          '<span class="pc-t"><b>' + esc(t.name) + '</b><small>' + io + '</small>' + st + '</span>' + shapeIcon(t) + '</button>';
      });
      html += '</div></div>';
    });
    $('palette').innerHTML = html || '<p class="empty">No module matches this search.</p>';
  }
  // A tiny drawing of the footprint shape, cells only (no numbers).
  function shapeIcon(t) {
    var s = Math.min(4, 22 / Math.max(t.w, t.h)), w = t.w * s, h = t.h * s, r = '';
    for (var y = 0; y < t.h; y++) for (var x = 0; x < t.w; x++) r += '<rect x="' + (x * s + 0.5) + '" y="' + (y * s + 0.5) + '" width="' + (s - 1) + '" height="' + (s - 1) + '"/>';
    return '<svg class="shape" viewBox="0 0 ' + (w + 1) + ' ' + (h + 1) + '" width="' + (w + 1) + '" height="' + (h + 1) + '" aria-hidden="true">' + r + '</svg>';
  }

  // ---- inspector ----------------------------------------------------------------
  function linkList(ids, title) {
    if (!ids || !ids.length) return '';
    return '<div class="ins-sec"><h4>' + title + '</h4><div class="links">' + ids.map(function (id) {
      var e = PL.byId[id]; if (!e) return '';
      return '<a class="lk" href="' + WIKI + encodeURIComponent(id) + '">' + entryThumb(e) + '<span>' + esc(e.name) + '</span></a>';
    }).join('') + '</div></div>';
  }
  function renderInspect() {
    var m = UI.sel ? PL.find(UI.sel) : null, t = m ? PL.T[m.t] : (UI.pick ? PL.T[UI.pick] : null), el = $('inspect');
    if (!t) {
      el.innerHTML = '<h3>Inspector</h3><p class="lead">Pick a module in the palette, then place it on the grid. Select a placed module to see what it is made from and where it sits in the wiki.</p>' +
        '<ul class="keys"><li><kbd>V</kbd> Select</li><li><kbd>B</kbd> Build</li><li><kbd>X</kbd> Erase</li><li><kbd>R</kbd> Rotate</li><li><kbd>F</kbd> Fit view</li><li><kbd>Ctrl</kbd>+<kbd>Z</kbd> Undo</li></ul>';
      return;
    }
    var f = t.entry.fields, chips = '';
    chips += '<span class="chip ' + (t.status === 'Buildable' ? 'ok' : 'dim') + '">' + esc(t.status || 'Module') + '</span>';
    if (t.section) chips += '<span class="chip">' + esc(t.section) + '</span>';
    chips += '<span class="chip lay">' + LAYER_NAME[t.layer] + ' layer</span>';
    t.tags.forEach(function (g) { if (g !== 'structural' && g !== 'furniture' && g !== 'turret') chips += '<span class="chip tag">' + TAG_NAME[g] + '</span>'; });
    var io = f.Input || f.Output ? '<div class="io"><span>' + esc(f.Input || '—') + '</span><svg viewBox="0 0 24 12"><path d="M1 6h20M16 1l5 5-5 5"/></svg><span>' + esc(f.Output || '—') + '</span></div>' : '';
    var where = '';
    if (m) {
      var pr = PL.problems().filter(function (p) { return p.m.u === m.u; })[0];
      where = '<div class="ins-state ' + (pr ? 'bad' : 'good') + '">' + (pr ? esc(pr.why) : 'Placement is clear') + (t.p.directional ? ' · faces ' + FACING[m.r] : '') + '</div>';
    }
    var big = t.img ? '<div class="ins-art"><img src="../../' + (t.wall && t.sprites[3] ? t.sprites[3] : t.sprites[0]) + '" alt=""></div>' : '<div class="ins-art sym" style="--ac:' + VW.accent(t) + '">' + esc(t.symbol) + '</div>';
    el.innerHTML = '<div class="ins-top">' + big + '<div><div class="kick">' + (m ? 'Selected' : 'To place') + '</div><h3 class="ins-name">' + esc(t.name) + '</h3>' +
      '<a class="wiki" href="' + WIKI + encodeURIComponent(t.id) + '">Open in the wiki →</a></div></div>' +
      '<div class="chips">' + chips + '</div>' + io + where +
      linkList(t.entry.links.madeFrom, 'Built from') + linkList(t.entry.links.unlockedBy, 'Unlocked by research') +
      (m && !t.core ? '<div class="ins-act"><button class="btn" data-act="rotate"' + (PL.rotations(t) > 1 ? '' : ' disabled') + '>Rotate</button><button class="btn warn" data-act="delete">Delete</button></div>' : '');
  }

  // ---- summary ----------------------------------------------------------------
  function renderSummary() {
    var counts = {}, order = [], E = PL.enclosure(), probs = PL.problems();
    PL.S.mods.forEach(function (m) { if (!counts[m.t]) { counts[m.t] = 0; order.push(m.t); } counts[m.t]++; });
    order.sort(function (a, b) { return counts[b] - counts[a] || PL.T[a].name.localeCompare(PL.T[b].name); });
    var html = '<h3>Station <span class="h-sub">' + esc($('stationName').value || 'Untitled') + '</span></h3>' +
      '<div class="stats"><div><b>' + PL.S.mods.length + '</b><span>modules</span></div><div><b>' + order.length + '</b><span>types</span></div><div><b>' + E.rooms.length + '</b><span>rooms</span></div><div class="' + (probs.length ? 'bad' : '') + '"><b>' + probs.length + '</b><span>problems</span></div></div>';
    if (probs.length) {
      html += '<div class="probs">' + probs.slice(0, 6).map(function (p) {
        return '<button class="prob" data-u="' + p.m.u + '"><b>' + esc(PL.T[p.m.t].name) + '</b><span>' + esc(p.why) + '</span></button>';
      }).join('') + (probs.length > 6 ? '<p class="fine">and more…</p>' : '') + '</div>';
    }
    html += '<div class="counts">' + order.map(function (s) {
      var t = PL.T[s];
      return '<a class="cnt" href="' + WIKI + encodeURIComponent(t.id) + '" title="Open ' + esc(t.name) + ' in the wiki">' + thumb(t, 'th sm') + '<span>' + esc(t.name) + '</span><b>×' + counts[s] + '</b></a>';
    }).join('') + '</div>';
    $('summary').innerHTML = html;
  }

  // ---- layers -----------------------------------------------------------------
  function renderLayers() {
    var h = '';
    ['hull', 'furniture', 'turret'].forEach(function (L) {
      h += '<div class="ly' + (UI.visible[L] ? '' : ' off') + '"><button class="ly-v" data-ly="' + L + '" title="Show or hide">' +
        (UI.visible[L] ? '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.6M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a10 10 0 0 0 4.2-.9"/></svg>') +
        '<span>' + LAYER_NAME[L] + '</span></button><button class="ly-l' + (UI.locked[L] ? ' on' : '') + '" data-lk="' + L + '" title="Lock or unlock" aria-label="Lock ' + LAYER_NAME[L] + '">' +
        (UI.locked[L] ? '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' : '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>') + '</button></div>';
    });
    h += '<button class="ly rules' + (PL.S.rules ? ' on' : '') + '" id="bRules" title="Turn placement checks on or off"><span class="dot"></span>Rules ' + (PL.S.rules ? 'on' : 'off') + '</button>';
    $('layers').innerHTML = h;
    $('layers2').innerHTML = h.replace('id="bRules"', 'id="bRules2"');
  }

  // ---- tools + hint ------------------------------------------------------------
  function setTool(t) {
    if (t === 'build' && !UI.pick) { toast('Pick a module first'); if (phone()) openSheet('side-l'); return; }
    UI.tool = t; UI.ghost = null; UI.run = null; UI.hoverU = 0;
    document.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.toggle('on', b.dataset.tool === t); });
    cv.style.cursor = t === 'pan' ? 'grab' : (t === 'erase' ? 'not-allowed' : (t === 'build' ? 'crosshair' : 'default'));
    $('wallMode').hidden = !(t === 'build' && UI.pick && PL.T[UI.pick].wall);
    hint(); VW.ask();
  }
  function pick(slug) {
    UI.pick = slug; UI.rot = 0; UI.sel = 0;
    document.querySelectorAll('.pc').forEach(function (b) { b.classList.toggle('on', b.dataset.slug === slug); });
    setTool('build'); renderInspect();
    if (phone()) closeSheets();
  }
  function hint() {
    var t = UI.pick ? PL.T[UI.pick] : null, s = '', touch = matchMedia('(hover: none)').matches;
    if (UI.tool === 'build' && t) {
      s = t.wall ? (UI.wallMode === 'room' ? 'Drag a rectangle to draw a room outline of <b>' + esc(t.name) + '</b>' : 'Drag to draw a line of <b>' + esc(t.name) + '</b>')
        : (touch ? 'Drag the ghost, lift to place <b>' + esc(t.name) + '</b>' : 'Click to place <b>' + esc(t.name) + '</b>') + (PL.rotations(t) > 1 ? ' · <kbd>R</kbd> rotates' : '');
    } else if (UI.tool === 'erase') s = 'Tap or drag over modules to remove them';
    else if (UI.tool === 'pan') s = 'Drag to pan · pinch or scroll to zoom';
    else if (UI.sel) { var m = PL.find(UI.sel); s = m ? '<b>' + esc(PL.T[m.t].name) + '</b> selected · drag to move' + (phone() ? ' · <button class="hl" data-sheet="side-r">Details</button>' : '') : ''; }
    else s = touch ? 'Tap a module to select it · two fingers pan and zoom' : 'Click to select · drag to move or pan · scroll to zoom';
    $('hint').innerHTML = s;
  }
  var toastT = 0;
  function toast(msg, bad) {
    var el = $('toast'); el.textContent = msg; el.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastT); toastT = setTimeout(function () { el.className = 'toast'; }, 2200);
  }

  // ---- after an edit -------------------------------------------------------------
  var saveT = 0, SV = null;   // SV: the screensaver state, null when it is off
  function changed() {
    if (UI.sel && !PL.find(UI.sel)) UI.sel = 0;
    renderInspect(); renderSummary(); hint(); VW.ask();
    $('bUndo').disabled = !PL.S.undo.length; $('bRedo').disabled = !PL.S.redo.length;
    clearTimeout(saveT);
    if (SV) return;
    saveT = setTimeout(function () {
      var h = '#s=' + PL.encode() + '&n=' + encodeURIComponent($('stationName').value || '');
      try { history.replaceState(null, '', h); } catch (e) {}
      try { localStorage.setItem('sn-planner-v1', JSON.stringify({ s: PL.encode(), n: $('stationName').value })); } catch (e) {}
    }, 250);
  }
  function doUndo() { if (PL.undo()) { changed(); toast('Undo'); } }
  function doRedo() { if (PL.redo()) { changed(); toast('Redo'); } }
  function rotate() {
    if (UI.drag && UI.drag.kind === 'move') { var tm = PL.T[UI.drag.m.t]; UI.drag.r = (UI.drag.r + 1) % PL.rotations(tm); moveGhost(UI.drag.last); return; }
    if (UI.tool === 'build' && UI.pick) {
      var t = PL.T[UI.pick], n = PL.rotations(t);
      if (n < 2) { toast('This module has one orientation'); return; }
      UI.rot = (UI.rot + 1) % n; if (UI.ghost) buildGhost(UI.lastW); hint(); VW.ask(); return;
    }
    var m = UI.sel && PL.find(UI.sel); if (!m) { toast('Select a module to rotate'); return; }
    var tt = PL.T[m.t], k = PL.rotations(tt); if (k < 2 || tt.core) { toast('This module has one orientation'); return; }
    var nr = (m.r + 1) % k, r = PL.check(m.t, m.x, m.y, nr, m.u);
    if (!r.ok && PL.S.rules) { toast(r.why, true); return; }
    PL.begin(); m.r = nr; PL.commit(); changed();
  }
  function del() {
    var m = UI.sel && PL.find(UI.sel); if (!m) { toast('Select a module to delete'); return; }
    if (PL.T[m.t].core) { toast('The core is the anchor and stays'); return; }
    PL.begin(); PL.remove(m.u); PL.commit(); UI.sel = 0; changed();
  }

  // ---- pointer input ---------------------------------------------------------------
  var ptrs = {}, pinch = null;
  function local(e) { var r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function hit(sx, sy) {
    var w = VW.toWorld(sx, sy), x = Math.floor(w[0]), y = Math.floor(w[1]), o = PL.occupancy(0);
    var k = PL.key(x, y);
    var order = ['turret', 'furniture', 'hull'];
    for (var i = 0; i < order.length; i++) {
      var L = order[i];
      if (!UI.visible[L] || UI.locked[L]) continue;
      if (o[L][k]) return o[L][k];
    }
    return null;
  }
  function cellAt(p) { var w = VW.toWorld(p[0], p[1]); return [Math.floor(w[0]), Math.floor(w[1])]; }
  function buildGhost(p) {
    if (!p || !UI.pick) return;
    UI.lastW = p;
    var t = PL.T[UI.pick], d = PL.dims(t, UI.rot), w = VW.toWorld(p[0], p[1]);
    var x = Math.floor(w[0] - d[0] / 2 + 0.5), y = Math.floor(w[1] - d[1] / 2 + 0.5);
    var r = PL.check(UI.pick, x, y, UI.rot, 0);
    UI.ghost = { t: UI.pick, x: x, y: y, r: UI.rot, ok: r.ok, why: r.why };
    tip(p, r.ok ? '' : r.why);
    VW.ask();
  }
  function moveGhost(p) {
    var D = UI.drag; if (!p) return;
    D.last = p;
    var t = PL.T[D.m.t], d = PL.dims(t, D.r), w = VW.toWorld(p[0], p[1]);
    var x = Math.floor(w[0] - d[0] / 2 + 0.5), y = Math.floor(w[1] - d[1] / 2 + 0.5);
    var r = PL.check(D.m.t, x, y, D.r, D.m.u);
    UI.ghost = { t: D.m.t, x: x, y: y, r: D.r, ok: r.ok, why: r.why };
    tip(p, r.ok ? '' : r.why);
    VW.ask();
  }
  function tip(p, txt) {
    var el = $('tip');
    if (!txt || !p) { el.hidden = true; return; }
    el.textContent = txt; el.hidden = false;
    var s = VW.size();
    el.style.left = Math.min(s[0] - 200, p[0] + 16) + 'px'; el.style.top = Math.max(8, p[1] - 38) + 'px';
  }
  function runPreview(a, b) {
    var cells = PL.runCells(a, b, UI.wallMode), o = PL.occupancy(0);
    // A run needs one cell next to the hull, unless the hull is empty or the rules are off.
    var hullN = Object.keys(o.hull).length, att = !PL.S.rules || !hullN || cells.some(function (c) {
      return o.hull[PL.key(c[0] + 1, c[1])] || o.hull[PL.key(c[0] - 1, c[1])] || o.hull[PL.key(c[0], c[1] + 1)] || o.hull[PL.key(c[0], c[1] - 1)];
    });
    UI.run = { t: UI.pick, a: a, cells: cells.map(function (c) { return [c[0], c[1], att && !o.any[PL.key(c[0], c[1])]]; }) };
    VW.ask();
  }
  function eraseAt(p) {
    var m = hit(p[0], p[1]);
    if (!m || PL.T[m.t].core) return;
    if (!UI.drag.began) { PL.begin(); UI.drag.began = true; }
    PL.remove(m.u); PL.commit(); changed();
  }

  function onDown(e) {
    cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
    var p = local(e);
    ptrs[e.pointerId] = p;
    var ids = Object.keys(ptrs);
    if (ids.length === 2) {
      // Second finger: cancel the one-finger action, start a pinch.
      if (UI.drag && UI.drag.kind === 'erase' && UI.drag.began) { /* keep erased modules */ }
      UI.drag = null; UI.run = null; if (UI.tool !== 'build' || e.pointerType !== 'mouse') UI.ghost = null;
      var a = ptrs[ids[0]], b = ptrs[ids[1]];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      tip(null); VW.ask(); return;
    }
    if (ids.length > 2) return;
    var touch = e.pointerType !== 'mouse';
    if (e.button === 1 || e.button === 2 || UI.tool === 'pan' || UI.space) { UI.drag = { kind: 'pan', p: p }; cv.style.cursor = 'grabbing'; e.preventDefault(); return; }
    if (UI.tool === 'build' && UI.pick) {
      var t = PL.T[UI.pick];
      if (t.wall) { var c = cellAt(p); UI.drag = { kind: 'run', a: c }; runPreview(c, c); }
      else { UI.drag = { kind: 'place', touch: touch, p0: p }; buildGhost(p); }
      return;
    }
    if (UI.tool === 'erase') { UI.drag = { kind: 'erase', began: false }; eraseAt(p); return; }
    var m = hit(p[0], p[1]);
    if (m) {
      UI.sel = m.u; renderInspect(); hint();
      var core = PL.T[m.t].core;
      UI.drag = core ? { kind: 'pan', p: p } : { kind: 'press', m: m, p0: p, r: m.r };
      VW.ask();
    } else {
      UI.drag = { kind: 'pan', p: p, p0: p, clear: true };
    }
  }
  function onMove(e) {
    var p = local(e);
    if (ptrs[e.pointerId]) ptrs[e.pointerId] = p;
    var ids = Object.keys(ptrs);
    if (pinch && ids.length === 2) {
      var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]), c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      VW.cam.x -= (c[0] - pinch.c[0]) / VW.cam.z; VW.cam.y -= (c[1] - pinch.c[1]) / VW.cam.z;
      if (pinch.d > 10) VW.zoomAt(c[0], c[1], d / pinch.d);
      pinch.d = d; pinch.c = c; VW.ask(); return;
    }
    var D = UI.drag;
    if (!D) {
      // Hover (mouse only).
      if (e.pointerType !== 'mouse') return;
      if (UI.tool === 'build' && UI.pick && !PL.T[UI.pick].wall) buildGhost(p);
      else if (UI.tool === 'build' && UI.pick) { var c0 = cellAt(p); var o = PL.occupancy(0); UI.run = { t: UI.pick, cells: [[c0[0], c0[1], !o.any[PL.key(c0[0], c0[1])]]] }; VW.ask(); }
      else { var hm = hit(p[0], p[1]), hu = hm ? hm.u : 0; if (hu !== UI.hoverU) { UI.hoverU = hu; VW.ask(); } cv.title = hm ? PL.T[hm.t].name : ''; }
      return;
    }
    if (D.kind === 'pan') {
      VW.cam.x -= (p[0] - D.p[0]) / VW.cam.z; VW.cam.y -= (p[1] - D.p[1]) / VW.cam.z; D.p = p;
      if (D.p0 && Math.hypot(p[0] - D.p0[0], p[1] - D.p0[1]) > 5) D.clear = false;
      VW.ask(); return;
    }
    if (D.kind === 'run') { runPreview(D.a, cellAt(p)); return; }
    if (D.kind === 'place') { buildGhost(p); return; }
    if (D.kind === 'erase') { eraseAt(p); return; }
    if (D.kind === 'press' && Math.hypot(p[0] - D.p0[0], p[1] - D.p0[1]) > 6) { D.kind = 'move'; }
    if (D.kind === 'move') moveGhost(p);
  }
  function onUp(e) {
    var p = local(e), D = UI.drag;
    delete ptrs[e.pointerId];
    if (pinch) { if (Object.keys(ptrs).length < 2) pinch = null; UI.drag = null; return; }
    UI.drag = null;
    cv.style.cursor = UI.tool === 'pan' ? 'grab' : (UI.tool === 'erase' ? 'not-allowed' : (UI.tool === 'build' ? 'crosshair' : 'default'));
    if (!D) return;
    if (D.kind === 'pan' && D.clear) { UI.sel = 0; renderInspect(); hint(); VW.ask(); }
    if (D.kind === 'run') {
      var cells = PL.runCells(D.a, cellAt(p), UI.wallMode);
      PL.begin();
      var n = PL.placeRun(UI.pick, cells);
      if (!n) { PL.S.undo.pop(); toast(PL.check(UI.pick, D.a[0], D.a[1], 0, 0).why || 'Nothing placed', true); }
      else if (n < cells.length) toast((cells.length - n) + ' cells skipped');
      UI.run = null; changed(); return;
    }
    if (D.kind === 'place') {
      buildGhost(p);
      var g = UI.ghost;
      if (g && g.ok) { PL.begin(); PL.add(g.t, g.x, g.y, g.r); PL.commit(); changed(); }
      else if (g) toast(g.why, true);
      if (D.touch) UI.ghost = null;
      tip(null); VW.ask(); return;
    }
    if (D.kind === 'move') {
      var gm = UI.ghost; UI.ghost = null; tip(null);
      if (gm && gm.ok) { PL.begin(); D.m.x = gm.x; D.m.y = gm.y; D.m.r = gm.r; PL.commit(); changed(); }
      else { if (gm) toast(gm.why, true); VW.ask(); }
      return;
    }
    if (D.kind === 'press') { renderInspect(); VW.ask(); }
  }
  function onWheel(e) {
    e.preventDefault();
    var p = local(e);
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) VW.zoomAt(p[0], p[1], Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
    else { VW.cam.x += e.deltaX / VW.cam.z; VW.ask(); }
    if (UI.tool === 'build' && UI.pick && !PL.T[UI.pick].wall) buildGhost(p);
  }

  // ---- keys -------------------------------------------------------------------------
  function onKey(e) {
    var tg = e.target && e.target.tagName;
    if (tg === 'INPUT' || tg === 'TEXTAREA') return;
    var k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
    if (mod && k === 'y') { e.preventDefault(); doRedo(); return; }
    if (mod) return;
    if (k === ' ') { UI.space = true; cv.style.cursor = 'grab'; e.preventDefault(); return; }
    if (k === 'v') setTool('select');
    else if (k === 'b') setTool('build');
    else if (k === 'x') setTool('erase');
    else if (k === 'h') setTool('pan');
    else if (k === 'r') rotate();
    else if (k === 'f') VW.fit();
    else if (k === '=' || k === '+') VW.zoomAt(VW.size()[0] / 2, VW.size()[1] / 2, 1.25);
    else if (k === '-') VW.zoomAt(VW.size()[0] / 2, VW.size()[1] / 2, 0.8);
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); del(); }
    else if (k === 'escape') { if (UI.drag && UI.drag.kind === 'move') { UI.drag = null; UI.ghost = null; } else if (UI.tool !== 'select') setTool('select'); else { UI.sel = 0; renderInspect(); } closeSheets(); hint(); VW.ask(); }
  }

  // ---- share + file -------------------------------------------------------------------
  function shareURL() {
    return location.href.split('#')[0] + '#s=' + PL.encode() + '&n=' + encodeURIComponent($('stationName').value || '');
  }
  function openShare() {
    var url = shareURL();
    $('shareText').value = url; $('shareDlg').hidden = false;
    $('shareText').focus(); $('shareText').select();
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast('Link copied'); }, function () { toast('Select the text and copy it'); });
    else { $('shareText').select(); try { document.execCommand('copy'); toast('Link copied'); } catch (e) { toast('Select the text and copy it'); } }
  }
  function exportJSON() {
    var name = $('stationName').value || 'station';
    var blob = new Blob([JSON.stringify(PL.toJSON(name), null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() + '.station.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    toast('Layout exported');
  }
  function importJSON(file) {
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var o = JSON.parse(rd.result), list = PL.fromJSON(o);
        PL.begin(); PL.load(list); if (o.name) $('stationName').value = String(o.name).slice(0, 40);
        UI.sel = 0; changed(); VW.fit(); toast('Layout imported');
      } catch (err) { toast('Import failed: ' + err.message, true); }
    };
    rd.readAsText(file);
  }
  function readHash() {
    var h = location.hash.replace(/^#/, ''), o = {};
    h.split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) o[kv.slice(0, i)] = kv.slice(i + 1); });
    return o;
  }

  // ---- sheets (phone) ----------------------------------------------------------------
  function openSheet(id) {
    closeSheets(true);
    $(id).classList.add('open'); $('scrim').classList.add('on');
  }
  function closeSheets(keepScrim) {
    $('side-l').classList.remove('open'); $('side-r').classList.remove('open');
    if (!keepScrim) $('scrim').classList.remove('on');
  }

  // ---- boot ---------------------------------------------------------------------------
  function boot() {
    if (window.self !== window.top) document.body.classList.add('in-frame');
    VW.init(cv);
    buildPalette(); renderLayers();
    // Start layout: the share link, then the last session, then the example.
    var h = readHash(), loaded = false;
    if (h.s !== undefined) {
      var dec = PL.decode(decodeURIComponent(h.s));
      PL.load(dec.mods); loaded = true;
      if (h.n) $('stationName').value = decodeURIComponent(h.n).slice(0, 40);
      if (dec.bad) setTimeout(function () { toast(dec.bad + ' unknown module groups skipped', true); }, 400);
    } else {
      try {
        var sv = JSON.parse(localStorage.getItem('sn-planner-v1') || 'null');
        if (sv && sv.s !== undefined) { PL.load(PL.decode(sv.s).mods); if (sv.n) $('stationName').value = sv.n; loaded = true; }
      } catch (e) {}
    }
    if (!loaded) { PL.load(PL.example()); $('stationName').value = 'Example station'; }
    PL.S.undo.length = 0;
    setTool('select'); changed(); VW.fit();

    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && !UI.drag) { UI.ghost = null; UI.hoverU = 0; if (UI.tool === 'build') UI.run = null; tip(null); VW.ask(); } });
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', function (e) { if (e.key === ' ') { UI.space = false; setTool(UI.tool); } });

    $('palette').addEventListener('click', function (e) { var b = e.target.closest('.pc'); if (b) pick(b.dataset.slug); });
    $('search').addEventListener('input', buildPalette);
    $('showUnlisted').addEventListener('change', buildPalette);
    document.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tool) setTool(b.dataset.tool);
      if (b.dataset.sheet) { if ($(b.dataset.sheet).classList.contains('open')) closeSheets(); else openSheet(b.dataset.sheet); }
      if (b.dataset.act === 'rotate') rotate();
      if (b.dataset.act === 'delete') del();
      if (b.dataset.act === 'undo') doUndo();
      if (b.dataset.ly) { UI.visible[b.dataset.ly] = !UI.visible[b.dataset.ly]; renderLayers(); VW.ask(); }
      if (b.dataset.lk) { UI.locked[b.dataset.lk] = !UI.locked[b.dataset.lk]; renderLayers(); }
      if (b.id === 'bRules' || b.id === 'bRules2') { PL.S.rules = !PL.S.rules; PL.commit(); renderLayers(); changed(); toast(PL.S.rules ? 'Placement checks on' : 'Placement checks off: free layout'); }
      if (b.dataset.wm) { UI.wallMode = b.dataset.wm; document.querySelectorAll('[data-wm]').forEach(function (x) { x.classList.toggle('on', x === b); }); hint(); }
      if (b.dataset.u) { setTool('select'); UI.sel = +b.dataset.u; renderInspect(); hint(); VW.ask(); }
    });
    document.querySelectorAll('.grab').forEach(function (g) { g.addEventListener('click', function () { closeSheets(); }); });
    $('scrim').addEventListener('click', function () { closeSheets(); });
    $('bUndo').onclick = doUndo; $('bRedo').onclick = doRedo;
    $('bRotate').onclick = rotate; $('bDelete').onclick = del;
    $('zIn').onclick = function () { VW.zoomAt(VW.size()[0] / 2, VW.size()[1] / 2, 1.25); };
    $('zOut').onclick = function () { VW.zoomAt(VW.size()[0] / 2, VW.size()[1] / 2, 0.8); };
    $('zFit').onclick = VW.fit;
    $('bShare').onclick = openShare; $('bShare2').onclick = function () { copy(shareURL()); };
    $('bCopy').onclick = function () { copy($('shareText').value); };
    $('bCloseDlg').onclick = function () { $('shareDlg').hidden = true; };
    $('shareDlg').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
    $('bExport').onclick = exportJSON;
    $('bImport').onclick = function () { $('fileIn').click(); };
    $('fileIn').onchange = function (e) { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ''; };
    $('bExample').onclick = function () { PL.begin(); PL.load(PL.example()); $('stationName').value = 'Example station'; UI.sel = 0; changed(); VW.fit(); };
    $('bClear').onclick = function () { if (!confirm('Clear the whole layout? Undo can bring it back.')) return; PL.begin(); PL.reset(); PL.commit(); UI.sel = 0; changed(); VW.fit(); };
    $('stationName').addEventListener('input', changed);
    window.addEventListener('hashchange', function () {
      var hh = readHash(); if (hh.s === undefined || hh.s === PL.encode()) return;
      PL.begin(); PL.load(PL.decode(decodeURIComponent(hh.s)).mods); changed(); VW.fit();
    });
  }
  boot();

  // ---- screensaver ------------------------------------------------------------------
  // Shell saver hook (lib/screensaver.js). enter() hides the panels and makes
  // #stage fill the window. The autopilot then builds the example station one
  // module at a time: the core, the hull outward from the core (each new
  // module touches the built part), then the furniture. Each module fades in.
  // The camera holds the fit of the full station with a slow drift. At the
  // end of a cycle it holds, fades to black and builds again. One cycle is
  // one dwell (opts.seconds). changed() writes no hash or localStorage here.
  window.snSaver = {
    enter: function (opts) {
      var calm = Math.max(0, Math.min(1, +opts.calm || 0)), seed = (opts.seed >>> 0) || 1;
      function rng() { seed = (seed + 0x6D2B79F5) >>> 0; var x = Math.imul(seed ^ seed >>> 15, 1 | seed); x ^= x + Math.imul(x ^ x >>> 7, 61 | x); return ((x ^ x >>> 14) >>> 0) / 4294967296; }
      SV = { on: true }; clearTimeout(saveT);
      var st = document.createElement('style');
      st.textContent = 'html.saver header.bar,html.saver #side-l,html.saver #side-r,html.saver nav.dock,html.saver #scrim,html.saver #shareDlg,' +
        'html.saver #stage>:not(#cv){display:none!important}html.saver #stage{position:fixed;inset:0;z-index:50}html.saver #cv{cursor:none}';
      document.head.appendChild(st);
      document.documentElement.classList.add('saver');
      closeSheets(); setTool('select');
      UI.saver = true; UI.sel = 0; UI.ghost = null; UI.run = null; UI.hoverU = 0; UI.drag = null;
      var cycle = Math.max(24, +opts.seconds || 60) * 1000, ease = 500 + 500 * calm, plan = [], t0 = 0, n = 0, bx = [0, 0, 1, 1], phase = rng() * 6.283;
      function order(list) {
        // Hull first, then the rest. Among each group, the next module touches
        // the built cells and is the nearest to the core, with a seeded jitter.
        var done = {}, out = [];
        PL.load([]); PL.S.mods.forEach(function (m) { PL.cellsOf(m).forEach(function (c) { done[PL.key(c[0], c[1])] = 1; }); });
        var left = list.filter(function (m) { return !PL.T[m.t].core; }).map(function (m) { return { m: m, j: rng() * 1.5 }; });
        while (left.length) {
          var best = -1, bd = 1e9;
          left.forEach(function (o, i) {
            var cells = PL.cellsOf(o.m), touch = cells.some(function (c) { return done[PL.key(c[0] + 1, c[1])] || done[PL.key(c[0] - 1, c[1])] || done[PL.key(c[0], c[1] + 1)] || done[PL.key(c[0], c[1] - 1)]; });
            var d = Math.hypot(o.m.x, o.m.y) + o.j + (touch ? 0 : 100) + (PL.T[o.m.t].layer === 'hull' ? 0 : 200);
            if (d < bd) { bd = d; best = i; }
          });
          var o = left.splice(best, 1)[0];
          PL.cellsOf(o.m).forEach(function (c) { done[PL.key(c[0], c[1])] = 1; });
          out.push(o.m);
        }
        return out;
      }
      function restart(now) {
        var ex = PL.example();
        bx = [1e9, 1e9, -1e9, -1e9];
        ex.forEach(function (m) { PL.cellsOf(m).forEach(function (c) { bx = [Math.min(bx[0], c[0]), Math.min(bx[1], c[1]), Math.max(bx[2], c[0] + 1), Math.max(bx[3], c[1] + 1)]; }); });
        plan = order(ex); n = 0; t0 = now;
        PL.S.mods.forEach(function (m) { m.a = 1; m.born = 0; });
        PL.S.undo.length = 0; PL.S.redo.length = 0; changed();
      }
      function frame(now) {
        var t = now - t0, build = cycle * 0.62, step = build / Math.max(1, plan.length);
        if (t >= cycle) { restart(now); t = 0; }
        while (n < plan.length && t >= 900 + n * step) {
          var p = plan[n++], m = PL.add(p.t, p.x, p.y, p.r);
          m.a = 0; m.born = now; PL.commit();
        }
        PL.S.mods.forEach(function (m) { if (m.born) m.a = Math.min(1, (now - m.born) / ease); });
        UI.fade = Math.max(0, 1 - t / 900, (t - (cycle - 1100)) / 1100);
        // Fit the full station to the window each frame (the stage size can
        // change), then add a slow drift and a small zoom swell.
        var sz = VW.size(), w = (now / 1000) * (0.05 - 0.035 * calm) + phase;
        var z = Math.min(64, sz[0] / (bx[2] - bx[0] + 6), sz[1] / (bx[3] - bx[1] + 5));
        VW.cam.x = (bx[0] + bx[2]) / 2 + Math.cos(w) * 1.2; VW.cam.y = (bx[1] + bx[3]) / 2 + Math.sin(w * 0.8) * 0.8; VW.cam.z = z * (1 + 0.05 * Math.sin(w * 0.6));
        VW.ask();
        requestAnimationFrame(frame);
      }
      restart(performance.now());
      requestAnimationFrame(frame);
      return { canvas: cv, warmupMs: 1500 };
    }
  };
})();
