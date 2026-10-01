// ============================================================================
//  STATION PLANNER  ·  model.js — module types, layout, rules, enclosure
// ----------------------------------------------------------------------------
//  This classic script reads window.SN_DATA (the names-only game catalog) and
//  makes one type record per station module. It also holds the layout (a list
//  of placed modules), the undo history, the planner rules and the share-link
//  codec. It draws nothing. view.js and main.js read the global PL object.
//
//  LAYERS
//      hull      every module that is not furniture and not a turret. Hull
//                cells block open space, so they make walls and rooms.
//      furniture modules with the furniture tag. They stand on floor cells.
//      turret    modules with the turret tag. They block open space too.
//
//  PLANNER RULES  (check)  — built only from the catalog placement tags
//      overlap ..... one module per cell, on all layers
//      attached .... a hull or turret module must touch the hull (side)
//      furniture ... every cell must be an enclosed floor cell
//      interior .... no side of the module may touch open space
//      exterior .... one side of the module must touch open space
//  The rules are a planning aid. They are not the game's own rule code.
//
//  ENCLOSURE  (enclosure)
//      A flood fill starts outside the hull bounds and moves through cells
//      that hull and turret modules do not hold. Each empty cell that the
//      fill does not reach is enclosed. Side-connected enclosed cells make
//      one room.
//
//  SECTION MAP   (jump with grep -n "<anchor>" model.js)
//      type table ......... "function buildTypes"
//      footprint .......... "function dims"
//      layout + undo ...... "function commit"
//      occupancy .......... "function occupancy"
//      enclosure .......... "function enclosure"
//      rules .............. "function check"
//      problems ........... "function problems"
//      wall runs .......... "function placeRun"
//      share codec ........ "function encode"
//      json file .......... "function toJSON"
//      example ............ "function example"
// ============================================================================
(function () {
  var D = window.SN_DATA || { entries: [], categories: [] };
  var byId = {};
  D.entries.forEach(function (e) { byId[e.id] = e; });

  // Palette sections in the order the game build palette uses.
  var SECTIONS = ['Structure', 'Production', 'Research', 'Utility', 'Habitat', 'Decorations', 'Antimatter'];

  // ---- type table ---------------------------------------------------------
  // One record per module entry. w and h come from the footprint rectangle.
  function buildTypes() {
    var list = [];
    D.entries.forEach(function (e) {
      if (e.category !== 'modules' || !e.placement) return;
      var p = e.placement, w = 1, h = 1;
      p.footprint.forEach(function (c) { w = Math.max(w, c[0] + 1); h = Math.max(h, c[1] + 1); });
      var layer = p.furniture ? 'furniture' : (p.turret ? 'turret' : 'hull');
      var tags = [];
      ['structural', 'furniture', 'turret', 'thruster', 'docking', 'interior', 'exterior', 'directional', 'flag'].forEach(function (k) { if (p[k]) tags.push(k); });
      list.push({
        id: e.id, slug: e.slug, name: e.name, entry: e,
        section: e.group || null,
        status: e.fields.Status || '',
        symbol: e.fields.Symbol || '◇',
        w: w, h: h, p: p, layer: layer, tags: tags,
        wall: !!(p.structural && w === 1 && h === 1),
        core: e.slug === 'structure-core',
        sprites: e.sprites || [],
        img: null, imgs: []
      });
    });
    return list;
  }
  var TYPES = buildTypes();
  var T = {};
  TYPES.forEach(function (t) { T[t.slug] = t; });

  // ---- footprint ----------------------------------------------------------
  // rot counts quarter turns clockwise. An odd rot swaps width and height.
  function dims(t, rot) { return (rot & 1) ? [t.h, t.w] : [t.w, t.h]; }
  // Which rotations a type offers: four for a facing, two for a long shape.
  function rotations(t) {
    if (t.p.directional) return 4;
    if (t.w !== t.h) return 2;
    return 1;
  }
  function cellsOf(m) {
    var t = T[m.t], d = dims(t, m.r), out = [];
    for (var y = 0; y < d[1]; y++) for (var x = 0; x < d[0]; x++) out.push([m.x + x, m.y + y]);
    return out;
  }
  function k(x, y) { return x + ',' + y; }

  // ---- layout + undo -------------------------------------------------------
  // A placed module is {u: unique id, t: type slug, x, y, r}. x,y is the
  // top-left cell of the rotated footprint.
  var S = { mods: [], next: 1, undo: [], redo: [], rules: true, rev: 0 };
  function snap() { return JSON.stringify(S.mods); }
  function begin() { S.undo.push(snap()); if (S.undo.length > 200) S.undo.shift(); S.redo.length = 0; }
  function commit() { S.rev++; cache = null; }
  function undo() { if (!S.undo.length) return false; S.redo.push(snap()); S.mods = JSON.parse(S.undo.pop()); renum(); commit(); return true; }
  function redo() { if (!S.redo.length) return false; S.undo.push(snap()); S.mods = JSON.parse(S.redo.pop()); renum(); commit(); return true; }
  function renum() { var n = 0; S.mods.forEach(function (m) { n = Math.max(n, m.u); }); S.next = n + 1; }
  function add(t, x, y, r) { var m = { u: S.next++, t: t, x: x, y: y, r: r || 0 }; S.mods.push(m); return m; }
  function remove(u) { S.mods = S.mods.filter(function (m) { return m.u !== u; }); }
  function find(u) { for (var i = 0; i < S.mods.length; i++) if (S.mods[i].u === u) return S.mods[i]; return null; }
  function reset() { S.mods = []; S.next = 1; if (T['structure-core']) add('structure-core', 0, 0, 0); }

  // ---- occupancy -----------------------------------------------------------
  // Maps cell key to module for each layer. skip leaves one module out, so a
  // move can test the layout without the module that moves.
  function occupancy(skip) {
    var o = { hull: {}, furniture: {}, turret: {}, any: {} };
    S.mods.forEach(function (m) {
      if (m.u === skip || !T[m.t]) return;
      var L = T[m.t].layer;
      cellsOf(m).forEach(function (c) { var kk = k(c[0], c[1]); o[L][kk] = m; o.any[kk] = m; });
    });
    return o;
  }

  // ---- enclosure -----------------------------------------------------------
  var cache = null;
  function enclosure(skip) {
    if (!skip && cache) return cache;
    var o = occupancy(skip), solid = {}, kk;
    for (kk in o.hull) solid[kk] = 1;
    for (kk in o.turret) solid[kk] = 1;
    var xs = [], ys = [];
    Object.keys(solid).forEach(function (s) { var p = s.split(','); xs.push(+p[0]); ys.push(+p[1]); });
    var res = { occ: o, solid: solid, inside: {}, rooms: [], roomOf: {}, bounds: null };
    if (!xs.length) { if (!skip) cache = res; return res; }
    var x0 = Math.min.apply(null, xs) - 1, x1 = Math.max.apply(null, xs) + 1;
    var y0 = Math.min.apply(null, ys) - 1, y1 = Math.max.apply(null, ys) + 1;
    res.bounds = [x0, y0, x1, y1];
    var out = {}, q = [];
    function push(x, y) { var s = k(x, y); if (x < x0 || x > x1 || y < y0 || y > y1 || out[s] || solid[s]) return; out[s] = 1; q.push(x, y); }
    for (var x = x0; x <= x1; x++) { push(x, y0); push(x, y1); }
    for (var y = y0; y <= y1; y++) { push(x0, y); push(x1, y); }
    while (q.length) { var qy = q.pop(), qx = q.pop(); push(qx + 1, qy); push(qx - 1, qy); push(qx, qy + 1); push(qx, qy - 1); }
    for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) { var s = k(x, y); if (!out[s] && !solid[s]) res.inside[s] = 1; }
    // Rooms: side-connected groups of enclosed cells.
    Object.keys(res.inside).forEach(function (s) {
      if (res.roomOf[s] !== undefined) return;
      var id = res.rooms.length, cells = [], st = [s];
      res.roomOf[s] = id;
      while (st.length) {
        var c = st.pop(), p = c.split(','), cx = +p[0], cy = +p[1];
        cells.push(c);
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var n = k(cx + d[0], cy + d[1]);
          if (res.inside[n] && res.roomOf[n] === undefined) { res.roomOf[n] = id; st.push(n); }
        });
      }
      res.rooms.push(cells);
    });
    if (!skip) cache = res;
    return res;
  }
  // Open space: a cell that is not solid and not enclosed.
  function isOpen(E, x, y) { var s = k(x, y); return !E.solid[s] && !E.inside[s]; }

  // ---- rules ---------------------------------------------------------------
  // Returns {ok, why}. skip is the uid of a module that moves (or 0).
  function check(slug, x, y, r, skip) {
    var t = T[slug]; if (!t) return { ok: false, why: 'Unknown module' };
    var d = dims(t, r), E = enclosure(skip || 0), o = E.occ, i, j, s;
    var cells = [];
    for (j = 0; j < d[1]; j++) for (i = 0; i < d[0]; i++) cells.push([x + i, y + j]);
    for (i = 0; i < cells.length; i++) if (o.any[k(cells[i][0], cells[i][1])]) return { ok: false, why: 'Cells are already in use' };
    if (!S.rules) return { ok: true, why: '' };
    var mine = {}; cells.forEach(function (c) { mine[k(c[0], c[1])] = 1; });
    // Side cells around the footprint.
    var ring = [];
    cells.forEach(function (c) {
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (dd) {
        var nx = c[0] + dd[0], ny = c[1] + dd[1];
        if (!mine[k(nx, ny)]) ring.push([nx, ny]);
      });
    });
    if (t.layer === 'furniture') {
      for (i = 0; i < cells.length; i++) if (!E.inside[k(cells[i][0], cells[i][1])]) return { ok: false, why: 'Furniture needs enclosed floor' };
      return { ok: true, why: '' };
    }
    var hasHull = Object.keys(o.hull).length > 0;
    if (hasHull) {
      var touch = ring.some(function (c) { return !!o.hull[k(c[0], c[1])]; });
      if (!touch) return { ok: false, why: 'Must touch the station hull' };
    }
    if (t.p.interior) {
      for (i = 0; i < ring.length; i++) { s = ring[i]; if (isOpen(E, s[0], s[1])) return { ok: false, why: 'Interior: must be inside walls' }; }
    }
    if (t.p.exterior) {
      var open = ring.some(function (c) { return isOpen(E, c[0], c[1]); });
      if (!open) return { ok: false, why: 'Exterior: must touch open space' };
    }
    return { ok: true, why: '' };
  }

  // ---- problems ------------------------------------------------------------
  // Modules that break a rule in the present layout (for example a room
  // that lost a wall). The core is the anchor, so it is never a problem.
  var probCache = { rev: -1, list: [] };
  function problems() {
    if (probCache.rev === S.rev) return probCache.list;
    var list = [];
    if (S.rules) S.mods.forEach(function (m) {
      if (T[m.t] && T[m.t].core) return;
      var keepRules = check(m.t, m.x, m.y, m.r, m.u);
      if (!keepRules.ok) list.push({ m: m, why: keepRules.why });
    });
    probCache = { rev: S.rev, list: list };
    return list;
  }

  // ---- wall runs -----------------------------------------------------------
  // Cells for a straight run (line) or a rectangle outline (room).
  function runCells(a, b, mode) {
    var out = [], x, y;
    if (mode === 'room') {
      var x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
      for (x = x0; x <= x1; x++) { out.push([x, y0]); if (y1 !== y0) out.push([x, y1]); }
      for (y = y0 + 1; y < y1; y++) { out.push([x0, y]); if (x1 !== x0) out.push([x1, y]); }
      return out;
    }
    if (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])) {
      var sx = b[0] >= a[0] ? 1 : -1;
      for (x = a[0]; x !== b[0] + sx; x += sx) out.push([x, a[1]]);
    } else {
      var sy = b[1] >= a[1] ? 1 : -1;
      for (y = a[1]; y !== b[1] + sy; y += sy) out.push([a[0], y]);
    }
    return out;
  }
  // Place a run. A cell that cannot attach yet can attach after its
  // neighbour lands, so the loop repeats until no cell changes.
  function placeRun(slug, cells) {
    var left = cells.slice(), placed = 0, moved = true;
    while (moved && left.length) {
      moved = false;
      for (var i = left.length - 1; i >= 0; i--) {
        var c = left[i];
        if (check(slug, c[0], c[1], 0, 0).ok) { add(slug, c[0], c[1], 0); commit(); placed++; left.splice(i, 1); moved = true; }
      }
    }
    return placed;
  }

  // ---- share codec ---------------------------------------------------------
  // Format v1: groups "slug.r:x_y,x_y" joined by "~". The core is implied.
  // An optional third part "x_y_n" is a row of n cells (one-cell-wide types).
  function encode() {
    var g = {}, order = [];
    S.mods.forEach(function (m) {
      if (T[m.t] && T[m.t].core && m.x === 0 && m.y === 0) return;
      var key = m.t + '.' + m.r;
      if (!g[key]) { g[key] = []; order.push(key); }
      g[key].push(m.x + '_' + m.y);
    });
    // A one-cell-wide type writes a row run "x_y_n" for n cells in a row.
    return order.map(function (key) {
      var pts = g[key].map(function (s) { var p = s.split('_'); return [+p[0], +p[1]]; });
      pts.sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });
      var t = T[key.split('.')[0]], one = oneWide(t, +key.split('.')[1]), out = [];
      for (var i = 0; i < pts.length; i++) {
        var n = 1;
        while (one && i + n < pts.length && pts[i + n][1] === pts[i][1] && pts[i + n][0] === pts[i][0] + n) n++;
        out.push(pts[i][0] + '_' + pts[i][1] + (n > 1 ? '_' + n : ''));
        i += n - 1;
      }
      return key + ':' + out.join(',');
    }).join('~');
  }
  function oneWide(t, r) { return dims(t, r)[0] === 1; }
  function decode(str) {
    var mods = [], bad = 0;
    (str || '').split('~').forEach(function (grp) {
      if (!grp) return;
      var c = grp.split(':'), head = c[0].split('.'), slug = head[0], r = (+head[1] || 0) & 3;
      if (!T[slug] || !c[1]) { bad++; return; }
      c[1].split(',').forEach(function (xy) {
        var p = xy.split('_'), x = parseInt(p[0], 10), y = parseInt(p[1], 10), n = Math.min(4096, parseInt(p[2], 10) || 1);
        if (!isFinite(x) || !isFinite(y)) return;
        for (var i = 0; i < n; i++) mods.push({ t: slug, x: x + i, y: y, r: r % rotations(T[slug]) });
      });
    });
    return { mods: mods, bad: bad };
  }
  function load(list) {
    S.mods = []; S.next = 1;
    var hasCore = list.some(function (m) { return T[m.t] && T[m.t].core; });
    if (!hasCore && T['structure-core']) add('structure-core', 0, 0, 0);
    list.forEach(function (m) { if (T[m.t]) add(m.t, m.x, m.y, m.r || 0); });
    commit();
  }

  // ---- json file -----------------------------------------------------------
  function toJSON(name) {
    return {
      format: 'stella-nova-station-plan', version: 1, name: name,
      modules: S.mods.map(function (m) { return { id: T[m.t].id, x: m.x, y: m.y, rot: m.r }; })
    };
  }
  function fromJSON(o) {
    if (!o || !Array.isArray(o.modules)) throw new Error('No modules list in this file');
    var list = [];
    o.modules.forEach(function (m) {
      var slug = String(m.id || '').replace(/^modules\//, '');
      if (T[slug] && isFinite(m.x) && isFinite(m.y)) list.push({ t: slug, x: m.x | 0, y: m.y | 0, r: ((m.rot | 0) & 3) % rotations(T[slug]) });
    });
    return list;
  }

  // ---- example -------------------------------------------------------------
  // A small hand-made layout: one hull room with production on the walls,
  // a farm inside, living quarters and thrusters on the outside.
  function example() {
    var L = [], x, y;
    function w(x, y) { L.push({ t: 'structure-white', x: x, y: y, r: 0 }); }
    for (x = -6; x <= 7; x++) { w(x, -5); w(x, 6); }
    for (y = -4; y <= 5; y++) {
      if (y !== 0) w(-6, y);
      if (y !== -3 && y !== -2 && y !== 2 && y !== 3) w(7, y);
    }
    for (x = -5; x <= 6; x++) if (x !== 0 && x !== 2 && x !== 3) w(x, 0);
    L.push({ t: 'foundry', x: 2, y: -1, r: 2 });
    L.push({ t: 'assembler', x: 7, y: -3, r: 0 });
    L.push({ t: 'component-lab', x: 7, y: 2, r: 0 });
    L.push({ t: 'hydroponics-garden', x: -5, y: 1, r: 0 });
    L.push({ t: 'hydroponics-plot', x: 2, y: 2, r: 0 });
    L.push({ t: 'hydroponics-bed', x: -2, y: -4, r: 0 });
    L.push({ t: 'hydroponics-bed', x: -5, y: -4, r: 0 });
    L.push({ t: 'research-bench', x: 1, y: -4, r: 1 });
    L.push({ t: 'docking', x: -2, y: -6, r: 0 });
    L.push({ t: 'docking', x: 2, y: -6, r: 0 });
    L.push({ t: 'thruster', x: -9, y: -2, r: 0 });
    L.push({ t: 'thruster', x: -9, y: 2, r: 0 });
    L.push({ t: 'hopper', x: -6, y: 0, r: 0 });
    L.push({ t: 'flag-mast', x: 0, y: 7, r: 0 });
    return L.filter(function (m) { return T[m.t]; }).map(function (m) { return { t: m.t, x: m.x, y: m.y, r: m.r }; });
  }

  window.PL = {
    D: D, byId: byId, TYPES: TYPES, T: T, SECTIONS: SECTIONS, S: S,
    dims: dims, rotations: rotations, cellsOf: cellsOf, key: k,
    begin: begin, commit: commit, undo: undo, redo: redo, add: add, remove: remove, find: find, reset: reset,
    occupancy: occupancy, enclosure: enclosure, isOpen: isOpen, check: check, problems: problems,
    runCells: runCells, placeRun: placeRun,
    encode: encode, decode: decode, load: load, toJSON: toJSON, fromJSON: fromJSON, example: example
  };
})();
