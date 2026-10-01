// ============================================================================
//  SELECTION  ·  interactive tutorial for click, box and modifier selection
// ----------------------------------------------------------------------------
//  A 2D canvas sandbox. Six lessons put real game sprites on the canvas:
//  ships (the livery layers, tinted), planets (texture maps on a sphere),
//  asteroids (ore sprites) and a station made of module sprites. The input
//  layer then shows how a click and a box resolve when things overlap.
//
//  The sprites come from window.SN_DATA (lib/game-data/catalog.js). This file
//  has no game code. The two priority ladders below are the teaching content
//  of this page, not values from the game source.
//
//  TWO PRIORITY LADDERS (lower rank wins)
//      click:  ship < enemy < planet < station < module < asteroid < star
//      box:    planet < ship < enemy < station < module < asteroid < star
//  A selection holds one type only. A new type replaces the old selection.
//
//  INPUT  (pointer events, so mouse, pen and touch use one path)
//      mouse   left click picks, left drag boxes, right or middle drag pans,
//              wheel zooms at the cursor, Ctrl or Cmd adds or removes.
//      touch   tap picks, hold then drag boxes, drag pans (boxes when the
//              Box toggle is on), pinch zooms, the Add toggle adds or removes.
//
//  STATION ZOOM
//      Below a zoom level the station is one entity. Above it, each module is
//      its own entity. Two levels (SPLIT_IN, SPLIT_OUT) stop a flicker at the
//      edge.
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//      sprite sources ....... "const SPRITES"       catalog lookups
//      type table ........... "const TYPES"         labels and ladders
//      lessons .............. "const LESSONS"       six lessons and copy
//      state ................ "const S ="           camera, gesture, flags
//      sprite loading ....... "function loadSprites"
//      ship tint ............ "function tintShip"   livery layers and masks
//      entity build ......... "function make"
//      spawn ................ "function spawn"
//      station .............. "function buildStation"
//      lesson load .......... "function loadLesson"
//      hit tests ............ "function hitAt"
//      click resolve ........ "function doClick"
//      box resolve .......... "function doBox"
//      pointer input ........ "function onDown"
//      wheel and pinch ...... "function zoomAt"
//      readout .............. "function updateReadout"
//      draw ................. "function frame"
//      ladders .............. "function buildLadders"
//      boot ................. "function boot"
// ============================================================================
(function () {
  'use strict';

  var DATA = window.SN_DATA || { entries: [] };
  var BYID = {};
  DATA.entries.forEach(function (e) { BYID[e.id] = e; });
  var ROOT = '../../';

  // Catalog lookups for every sprite this page draws. A missing entry gives
  // an empty list, and the draw code falls back to a plain shape.
  function spritesOf(id) { var e = BYID[id]; return e && e.sprites ? e.sprites : []; }
  var SPRITES = {
    planets: ['planets/terran', 'planets/lush', 'planets/desert', 'planets/volcanic', 'planets/toxic', 'planets/exotic', 'planets/barren'],
    ores: DATA.entries.filter(function (e) { return e.category === 'resources' && e.tier === 'Ores' && e.sprites.length; }).map(function (e) { return e.id; }),
    livery: ['ship-livery/hull', 'ship-livery/cockpit', 'ship-livery/accents'],
    // Station layout, row by row. Each cell is one module sprite.
    station: [
      ['modules/hopper', 'modules/foundry', 'modules/assembler'],
      ['modules/docking', 'modules/structure-core', 'modules/crew-quarters'],
      ['modules/hydroponics-bed', 'modules/research-bench', 'modules/thruster']
    ]
  };

  // One record per entity type. click and box are the ladder ranks.
  var TYPES = {
    ship:     { label: 'Ship',     plural: 'Ships',     click: 0, box: 1, r: 17, color: '#7fd8ff' },
    enemy:    { label: 'Enemy',    plural: 'Enemies',   click: 1, box: 2, r: 17, color: '#ff8a80' },
    planet:   { label: 'Planet',   plural: 'Planets',   click: 2, box: 0, r: 34, color: '#7ee08a' },
    station:  { label: 'Station',  plural: 'Stations',  click: 3, box: 3, r: 38, color: '#ffc832' },
    module:   { label: 'Module',   plural: 'Modules',   click: 4, box: 4, r: 12, color: '#ffa860' },
    asteroid: { label: 'Asteroid', plural: 'Asteroids', click: 5, box: 5, r: 13, color: '#d8c4a4' },
    star:     { label: 'Star',     plural: 'Stars',     click: 9, box: 9, r: 24, color: '#fff0b0' }
  };
  var DRAW_ORDER = ['star', 'planet', 'station', 'module', 'asteroid', 'enemy', 'ship'];
  var CELL = 26;           // station cell size in world units
  var SPLIT_IN = 1.9;      // zoom at which the station splits into modules
  var SPLIT_OUT = 1.45;    // zoom below which the modules join again
  var Z_MIN = 0.6, Z_MAX = 3.4;
  var HOLD_MS = 380;       // long-press time that arms a touch box
  var TOUCH_SLOP = 10, MOUSE_SLOP = 5;

  // ── lessons ────────────────────────────────────────────────────────────
  // Each lesson has chip and panel copy, a task for mouse and one for touch,
  // and a setup() that fills ents. setup() runs in world units where the
  // visible area is the box (0,0)-(W,H) at zoom 1.
  var LESSONS = [
    {
      id: 'basics', name: 'Click & Box', accent: '#96c8ff',
      head: 'Click &amp; <em>Box</em>',
      desc: 'Click one entity to select it. Drag a rectangle to select many at once.',
      notes: ['Left-click any entity to select it.', 'Click and drag in empty space to draw a box.', 'Click empty space to clear.'],
      hint: 'Click any ship, then <strong>drag a box</strong> around several asteroids.',
      hintTouch: 'Tap a ship. Then <strong>hold and drag</strong> a box around some asteroids.',
      setup: function () {
        spawn('ship', 8, 'wide'); spawn('enemy', 3, 'wide');
        spawn('asteroid', 60, 'wide'); spawn('planet', 2, 'wide'); spawn('star', 3, 'corners');
      }
    },
    {
      id: 'priority', name: 'Priority', accent: '#7ee08a',
      head: 'Overlap <em>Priority</em>',
      desc: 'When entities sit on top of each other, the system picks the one you probably meant.',
      notes: ['A ship on a planet: clicking gets the <code>ship</code>.', 'You rarely want the bigger background object.', 'The same applies to ships on stations and asteroids on planets.'],
      hint: 'Each ship sits <strong>on top of</strong> a planet. Click one: <strong>the ship wins</strong>.',
      hintTouch: 'Each ship sits <strong>on top of</strong> a planet. Tap one: <strong>the ship wins</strong>.',
      setup: function () {
        var pts = narrow() ? [[0.32, 0.36], [0.68, 0.52], [0.36, 0.72]] : [[0.28, 0.42], [0.55, 0.62], [0.42, 0.78]];
        pts.forEach(function (p) {
          var x = W * p[0], y = Y0 + (Y1 - Y0) * p[1];
          ents.push(make('planet', x, y));
          var s = make('ship', x + rnd(-6, 6), y + rnd(-6, 6)); s.vx = s.vy = 0; ents.push(s);
        });
        buildStation(W * (narrow() ? 0.7 : 0.8), Y0 + (Y1 - Y0) * (narrow() ? 0.2 : 0.3));
        var s2 = make('ship', S.station.x + 6, S.station.y - 4); s2.vx = s2.vy = 0; ents.push(s2);
        spawn('asteroid', 50, 'wide'); spawn('star', 2, 'corners');
      }
    },
    {
      id: 'clickbox', name: 'Click vs Box', accent: '#ffa860',
      head: 'Click <em>vs</em> Box',
      desc: 'Clicking and box-dragging use different priorities. Clicking favours small useful things. Boxing favours the big important ones.',
      notes: ['Click in a busy area: you get a <code>ship</code>.', 'Box over the same area: you get the <code>planet</code> instead.', 'A box over a system should take the planets, not every ship that orbits them.'],
      hint: '<strong>Click a ship</strong> in the ring, then <strong>box-drag</strong> over the planet. The result differs.',
      hintTouch: '<strong>Tap a ship</strong> in the ring, then <strong>hold and drag</strong> over the planet. The result differs.',
      setup: function () {
        var px = W * (narrow() ? 0.5 : 0.4), py = Y0 + (Y1 - Y0) * 0.55;
        var p = make('planet', px, py); ents.push(p);
        var ring = Math.min(W, Y1 - Y0) * 0.22 + 30;
        for (var i = 0; i < 12; i++) {
          var a = (i / 12) * Math.PI * 2;
          var rad = ring * rnd(0.75, 1.1);
          var s = make('ship', px + Math.cos(a) * rad, py + Math.sin(a) * rad);
          s.orbit = { cx: px, cy: py, a: a, rad: rad, w: 0.0016 };
          ents.push(s);
        }
        if (!narrow()) ents.push(make('planet', W * 0.8, Y0 + (Y1 - Y0) * 0.25));
        spawn('asteroid', 50, 'wide'); spawn('enemy', 3, 'edges');
      }
    },
    {
      id: 'modifier', name: 'Modifier', accent: '#ffc832',
      head: 'Hold <em>Modifier</em>',
      desc: 'Hold Cmd or Ctrl while you click to add to your selection. Click an entity that is already selected to remove only that one.',
      notes: ['Hold <code>Cmd</code> or <code>Ctrl</code> and click: adds to the selection.', 'Click a selected entity with the modifier: removes it.', 'Touch: turn on <strong>Add</strong> in the dock. It acts as a held modifier.'],
      hint: 'Click a ship, then <code>Ctrl</code>/<code>Cmd</code>-click more. Then modifier-click a selected one to remove it.',
      hintTouch: 'Tap a ship. Turn on <strong>Add</strong> and tap more. Tap a selected one to remove it.',
      setup: function () { spawn('ship', 12, 'wide'); spawn('enemy', 4, 'wide'); spawn('asteroid', 30, 'wide'); }
    },
    {
      id: 'lock', name: 'Category Lock', accent: '#c8a0ff',
      head: 'Category <em>Lock</em>',
      desc: 'You can never mix types in one selection. A new category replaces the old one, even with the modifier held.',
      notes: ['A selection is always one category.', 'Click a different type: the previous selection drops out.', 'Modifier-click on empty space: nothing changes (safe).'],
      hint: 'Select some ships, then click an asteroid. <strong>The ships are released.</strong>',
      hintTouch: 'Select some ships, then tap an asteroid. <strong>The ships are released.</strong>',
      setup: function () { spawn('ship', 9, 'left'); spawn('asteroid', 40, 'right'); spawn('enemy', 3, 'wide'); spawn('planet', 2, 'wide'); }
    },
    {
      id: 'modules', name: 'Zoom & Modules', accent: '#6fe0e8',
      head: 'Zoom &amp; <em>Modules</em>',
      desc: 'Zoom in past the threshold and a station splits into its modules. Each module then takes clicks of its own.',
      notes: ['Low zoom: the station is one entity.', 'High zoom: each module is its own entity.', 'The threshold has hysteresis, so there is no flicker at the edge.'],
      hint: 'Zoom in with the wheel or <code>+</code>. The station splits into modules. Click a module.',
      hintTouch: 'Pinch or tap <strong>+</strong> to zoom in. The station splits into modules. Tap a module.',
      setup: function () {
        buildStation(W * 0.5, Y0 + (Y1 - Y0) * 0.52);
        spawn('ship', 5, 'edges'); spawn('enemy', 2, 'edges'); spawn('asteroid', 50, 'wide');
      }
    }
  ];

  // ── state ──────────────────────────────────────────────────────────────
  // cam: world point at the view centre and zoom. g: the active gesture.
  // pts: live pointers by id (for pinch). add: the Add toggle. boxMode: the
  // Box toggle (touch only). kbMod: a held Ctrl or Cmd key.
  var S = {
    lesson: 0, cam: { x: 0, y: 0, z: 1 }, split: false,
    g: null, pts: {}, add: false, boxMode: false, kbMod: false,
    hover: null, preview: null, station: null, t: 0
  };
  var ents = [];
  var W = 0, H = 0, Y0 = 0, Y1 = 0, dpr = 1;
  var cv = document.getElementById('cv');
  var ctx = cv.getContext('2d');
  var IMG = {};       // path -> HTMLImageElement
  var SHIP = {};      // 'ship' | 'enemy' -> tinted canvas
  var stars = [];     // background dots in screen space
  var TOUCH = window.matchMedia && window.matchMedia('(hover: none)').matches;

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }
  function narrow() { return W < 640; }
  function $(id) { return document.getElementById(id); }

  // ── sprite loading ─────────────────────────────────────────────────────
  // Load every sprite path once. The callback runs when all have settled,
  // so one bad file does not stop the page.
  function loadSprites(done) {
    var paths = [];
    SPRITES.planets.forEach(function (id) { var s = spritesOf(id); if (s[0]) paths.push(s[0]); });
    SPRITES.ores.forEach(function (id) { spritesOf(id).forEach(function (p) { paths.push(p); }); });
    SPRITES.livery.forEach(function (id) { spritesOf(id).forEach(function (p) { paths.push(p); }); });
    SPRITES.station.forEach(function (row) { row.forEach(function (id) { var s = spritesOf(id); if (s[0]) paths.push(s[0]); }); });
    var left = paths.length;
    if (!left) { done(); return; }
    paths.forEach(function (p) {
      var im = new Image();
      im.onload = im.onerror = function () { if (--left === 0) done(); };
      im.src = ROOT + p;
      IMG[p] = im;
    });
  }
  function ok(im) { return im && im.complete && im.naturalWidth > 0; }

  // Compose the three livery layers into one ship canvas. Each layer is
  // multiplied by its tint where its mask is white. The colour layer alpha
  // then trims the result. Compositing only, so it also works from file://.
  function tintShip(tints) {
    var N = 160, c = document.createElement('canvas');
    c.width = c.height = N;
    var x = c.getContext('2d');
    SPRITES.livery.forEach(function (id, i) {
      var sp = spritesOf(id), col = IMG[sp[0]], mask = IMG[sp[1]];
      if (!ok(col)) return;
      var l = document.createElement('canvas'); l.width = l.height = N;
      var lx = l.getContext('2d');
      lx.drawImage(col, 0, 0, N, N);
      if (ok(mask)) {
        var m = document.createElement('canvas'); m.width = m.height = N;
        var mx = m.getContext('2d');
        mx.drawImage(mask, 0, 0, N, N);
        mx.globalCompositeOperation = 'source-in';
        mx.fillStyle = tints[i]; mx.fillRect(0, 0, N, N);
        lx.globalCompositeOperation = 'multiply'; lx.drawImage(m, 0, 0);
        lx.globalCompositeOperation = 'destination-in'; lx.drawImage(col, 0, 0, N, N);
      }
      x.drawImage(l, 0, 0);
    });
    return c;
  }

  // ── entity build ───────────────────────────────────────────────────────
  // One entity of a type at world (x,y). Drifters get a slow velocity and a
  // spin. Each kind takes a random sprite from its pool.
  function make(type, x, y) {
    var e = { type: type, x: x, y: y, r: TYPES[type].r, sel: false, vx: 0, vy: 0, rot: rnd(0, 6.283), spin: 0 };
    if (type === 'ship' || type === 'enemy') { var a = rnd(0, 6.283), v = rnd(0.05, 0.16); e.vx = Math.cos(a) * v; e.vy = Math.sin(a) * v; e.rot = a; }
    if (type === 'asteroid') {
      var ore = pick(SPRITES.ores.length ? SPRITES.ores : ['']);
      e.img = pick(spritesOf(ore).length ? spritesOf(ore) : ['']);
      e.r = rnd(9, 16); e.spin = rnd(-0.006, 0.006); e.vx = rnd(-0.05, 0.05); e.vy = rnd(-0.05, 0.05);
    }
    if (type === 'planet') { var pid = pick(SPRITES.planets); e.img = spritesOf(pid)[0]; e.r = rnd(30, 40); e.phase = rnd(0, 1); e.spinRate = rnd(0.00003, 0.00006); }
    if (type === 'star') { e.tw = rnd(0, 6.283); e.r = rnd(18, 26); }
    return e;
  }

  // Scatter n entities of a type into a region of the visible area. The count
  // scales with the screen area so a phone is not crowded.
  function spawn(type, n, region) {
    var k = Math.max(0.35, Math.min(1.2, (W * (Y1 - Y0)) / (1100 * 640)));
    var m = Math.max(Math.min(n, 3), Math.round(n * k));
    for (var i = 0; i < m; i++) {
      var x, y, tries = 0, r = TYPES[type].r;
      do {
        if (region === 'left') x = rnd(0.06, 0.4) * W;
        else if (region === 'right') x = rnd(0.58, 0.94) * W;
        else if (region === 'edges') x = Math.random() < 0.5 ? rnd(0.05, 0.22) * W : rnd(0.78, 0.95) * W;
        else if (region === 'corners') x = (Math.random() < 0.5 ? rnd(0.06, 0.14) : rnd(0.86, 0.94)) * W;
        else x = rnd(0.05, 0.95) * W;
        y = region === 'corners' ? (Math.random() < 0.5 ? Y0 + 20 : Y1 - 20) + rnd(-10, 10) : rnd(Y0 + r, Y1 - r);
        tries++;
      } while (crowded(x, y, r, type) && tries < 40);
      ents.push(make(type, x, y));
    }
  }
  function crowded(x, y, r, type) {
    for (var i = 0; i < ents.length; i++) {
      var e = ents[i], gap = (type === 'asteroid' && e.type === 'asteroid') ? -4 : 6;
      if (Math.hypot(e.x - x, e.y - y) < r + e.r + gap) return true;
    }
    return false;
  }

  // Build a station at (cx,cy): one station entity plus one module entity per
  // cell. Only one of the two layers takes input at a time (see S.split).
  function buildStation(cx, cy) {
    var st = make('station', cx, cy);
    st.r = CELL * 1.6;
    ents.push(st);
    S.station = st;
    SPRITES.station.forEach(function (row, ri) {
      row.forEach(function (id, ci) {
        var m = make('module', cx + (ci - 1) * CELL, cy + (ri - 1) * CELL);
        var en = BYID[id];
        m.name = en ? en.name : 'Module';
        m.img = en && en.sprites[0];
        m.r = CELL * 0.5;
        ents.push(m);
      });
    });
  }

  // True when an entity takes input now. The station layer and the module
  // layer swap at the split.
  function live(e) {
    if (e.type === 'station') return !S.split;
    if (e.type === 'module') return S.split;
    return true;
  }

  // ── lesson load ────────────────────────────────────────────────────────
  // Reset to lesson i: measure the free area under the chips and over the
  // dock, rebuild the entities, then push the copy into the panel.
  function loadLesson(i) {
    S.lesson = i; S.g = null; S.split = false; S.station = null; S.hover = null; S.preview = null;
    resize();
    var stage = $('stage').getBoundingClientRect();
    var hint = $('hint');
    var L = LESSONS[i];
    hint.innerHTML = '<span class="hk">Task</span><span>' + (TOUCH ? L.hintTouch : L.hint) + '</span>';
    Y0 = Math.max(60, hint.getBoundingClientRect().bottom - stage.top + 10);
    var dockTop = $('dock').getBoundingClientRect().top - stage.top;
    Y1 = Math.min(H - 20, dockTop - 54);
    if (Y1 - Y0 < 160) Y1 = Math.min(H - 10, Y0 + 160);
    if (!narrow()) $('toast').style.top = Y0 + 'px';
    S.cam = { x: W / 2, y: H / 2, z: 1 };
    ents = [];
    L.setup();
    document.documentElement.style.setProperty('--ac', L.accent);
    $('lsKicker').textContent = 'Lesson ' + pad(i + 1) + ' / ' + pad(LESSONS.length);
    $('lsHead').innerHTML = L.head;
    $('lsDesc').textContent = L.desc;
    $('lsNotes').innerHTML = L.notes.map(function (n) { return '<li>' + n + '</li>'; }).join('');
    document.querySelectorAll('.tab').forEach(function (b, k) { b.classList.toggle('on', k === i); b.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
    var on = document.querySelector('.tab.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    try { localStorage.setItem('sn_selection_lesson', String(i)); } catch (e) { /* storage off */ }
    updateZoomRo();
    updateReadout();
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // ── camera ─────────────────────────────────────────────────────────────
  function toScreen(x, y) { return { x: (x - S.cam.x) * S.cam.z + W / 2, y: (y - S.cam.y) * S.cam.z + H / 2 }; }
  function toWorld(x, y) { return { x: (x - W / 2) / S.cam.z + S.cam.x, y: (y - H / 2) / S.cam.z + S.cam.y }; }

  // Zoom to z with the screen point (sx,sy) held still, then re-check the
  // station split with hysteresis.
  function zoomAt(sx, sy, z) {
    z = Math.max(Z_MIN, Math.min(Z_MAX, z));
    var before = toWorld(sx, sy);
    S.cam.z = z;
    var after = toWorld(sx, sy);
    S.cam.x += before.x - after.x; S.cam.y += before.y - after.y;
    var was = S.split;
    S.split = was ? z >= SPLIT_OUT : z >= SPLIT_IN;
    if (was !== S.split && S.station) {
      var dropped = ents.some(function (e) { return e.sel && !live(e); });
      ents.forEach(function (e) { if (!live(e)) e.sel = false; });
      flash(S.split ? 'Station split into modules' : 'Modules joined into one station', 'info');
      if (dropped) updateReadout();
    }
    updateZoomRo();
  }
  function updateZoomRo() { $('zoomRo').textContent = S.cam.z.toFixed(1) + '×'; }

  // ── hit tests ──────────────────────────────────────────────────────────
  // All live entities under a world point. Modules test their square cell;
  // the rest test a circle. slop is a screen-pixel margin for fingers.
  function hitAt(wx, wy, slop) {
    var s = slop / S.cam.z;
    return ents.filter(function (e) {
      if (!live(e)) return false;
      if (e.type === 'module' || e.type === 'station') {
        var h = e.type === 'module' ? CELL / 2 : CELL * 1.5;
        return Math.abs(wx - e.x) <= h + s && Math.abs(wy - e.y) <= h + s;
      }
      return Math.hypot(e.x - wx, e.y - wy) <= e.r + s;
    });
  }
  function inBox(e, b) {
    var h = e.type === 'module' ? CELL / 2 : e.type === 'station' ? CELL * 1.5 : e.r;
    return e.x + h > b.x1 && e.x - h < b.x2 && e.y + h > b.y1 && e.y - h < b.y2;
  }
  function byRank(key) { return function (a, b) { return TYPES[a.type][key] - TYPES[b.type][key]; }; }

  // The entity a click at (wx,wy) would take, or null.
  function clickWinner(wx, wy) {
    var hits = hitAt(wx, wy, TOUCH ? 12 : 4);
    if (!hits.length) return null;
    hits.sort(byRank('click'));
    return hits[0];
  }
  // The entities a box would take: every live entity of the best box type.
  function boxWinners(b) {
    var inside = ents.filter(function (e) { return live(e) && inBox(e, b); });
    if (!inside.length) return [];
    inside.sort(byRank('box'));
    var t = inside[0].type;
    return inside.filter(function (e) { return e.type === t; });
  }

  // ── click resolve ──────────────────────────────────────────────────────
  // No hit clears (or keeps, with the modifier). A hit takes the best click
  // rank. With the modifier the pick toggles inside its category, but a new
  // category replaces the old selection (category lock).
  function doClick(wx, wy, mod) {
    var pickE = clickWinner(wx, wy);
    if (!pickE) {
      if (mod) { flash('Selection kept', 'info'); return; }
      var had = ents.some(function (e) { return e.sel; });
      ents.forEach(function (e) { e.sel = false; });
      if (had) flash('Selection cleared', 'warn');
      return;
    }
    var cur = ents.filter(function (e) { return e.sel; });
    if (mod) {
      if (cur.length && cur[0].type !== pickE.type) {
        ents.forEach(function (e) { e.sel = false; });
        pickE.sel = true;
        flash('Category lock: switched to ' + TYPES[pickE.type].plural, 'lock');
      } else {
        pickE.sel = !pickE.sel;
        if (!pickE.sel) flash('Removed one ' + TYPES[pickE.type].label.toLowerCase(), 'info');
      }
    } else {
      if (cur.length && cur[0].type !== pickE.type) flash(TYPES[cur[0].type].plural + ' released', 'lock');
      ents.forEach(function (e) { e.sel = false; });
      pickE.sel = true;
      pulse(pickE);
    }
  }

  // ── box resolve ────────────────────────────────────────────────────────
  // The best box type in the rectangle takes the selection. Modifier and
  // category lock act as in doClick.
  function doBox(b, mod) {
    var win = boxWinners(b);
    if (!win.length) {
      if (mod) { flash('Selection kept', 'info'); return; }
      var had = ents.some(function (e) { return e.sel; });
      ents.forEach(function (e) { e.sel = false; });
      if (had) flash('Selection cleared', 'warn');
      return;
    }
    var t = win[0].type;
    var cur = ents.filter(function (e) { return e.sel; });
    var switched = cur.length && cur[0].type !== t;
    if (!mod || switched) ents.forEach(function (e) { e.sel = false; });
    win.forEach(function (e) { e.sel = true; pulse(e); });
    if (switched) flash((mod ? 'Category lock: switched to ' : 'Box took ') + TYPES[t].plural, 'lock');
  }
  function pulse(e) { e.pulse = S.t; }

  // ── pointer input ──────────────────────────────────────────────────────
  // One gesture record at a time in S.g:
  //   mode 'wait'  pressed, not moved yet (a tap or click if it ends here)
  //   mode 'box'   drawing a rectangle
  //   mode 'pan'   moving the camera
  //   mode 'pinch' two touches, zoom and pan
  function local(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function modOn(e) { return S.add || S.kbMod || !!(e && (e.ctrlKey || e.metaKey)); }

  function onDown(e) {
    var p = local(e);
    S.pts[e.pointerId] = p;
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* old browser */ }
    var ids = Object.keys(S.pts);
    if (e.pointerType !== 'mouse' && ids.length === 2) {
      cancelHold();
      var a = S.pts[ids[0]], b = S.pts[ids[1]];
      S.g = { mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: S.cam.z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (ids.length > 1) return;
    if (e.pointerType === 'mouse' && e.button !== 0) {
      S.g = { mode: 'pan', id: e.pointerId, lx: p.x, ly: p.y };
      cv.classList.add('panning');
      e.preventDefault();
      return;
    }
    var touch = e.pointerType !== 'mouse';
    S.g = { mode: 'wait', id: e.pointerId, touch: touch, sx: p.x, sy: p.y, cx: p.x, cy: p.y, lx: p.x, ly: p.y, mod: modOn(e) };
    if (touch && !S.boxMode) {
      // Long press arms a box. The ring shows the press time.
      var ring = $('press');
      ring.style.left = p.x + 'px'; ring.style.top = p.y + 'px';
      ring.className = ''; void ring.offsetWidth; ring.className = 'run';
      S.g.timer = setTimeout(function () {
        if (S.g && S.g.mode === 'wait') {
          S.g.mode = 'box'; S.g.armed = true;
          ring.className = 'done';
          if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) { try { navigator.vibrate(12); } catch (err) { /* no haptics */ } }
        }
      }, HOLD_MS);
    }
  }

  function onMove(e) {
    var p = local(e);
    if (S.pts[e.pointerId]) S.pts[e.pointerId] = p;
    var g = S.g;
    if (!g) {
      if (e.pointerType === 'mouse') { var w = toWorld(p.x, p.y); S.hover = clickWinner(w.x, w.y); }
      return;
    }
    if (g.mode === 'pinch') {
      var ids = Object.keys(S.pts);
      if (ids.length < 2) return;
      var a = S.pts[ids[0]], b = S.pts[ids[1]];
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      S.cam.x -= (mx - g.mx) / S.cam.z; S.cam.y -= (my - g.my) / S.cam.z;
      g.mx = mx; g.my = my;
      zoomAt(mx, my, g.z0 * Math.hypot(a.x - b.x, a.y - b.y) / g.d0);
      return;
    }
    if (e.pointerId !== g.id) return;
    if (g.mode === 'pan') {
      S.cam.x -= (p.x - g.lx) / S.cam.z; S.cam.y -= (p.y - g.ly) / S.cam.z;
      g.lx = p.x; g.ly = p.y;
      return;
    }
    g.cx = p.x; g.cy = p.y;
    var moved = Math.hypot(p.x - g.sx, p.y - g.sy);
    if (g.mode === 'wait') {
      if (g.touch && moved > TOUCH_SLOP) {
        cancelHold();
        if (S.boxMode) g.mode = 'box';
        else { g.mode = 'pan'; cv.classList.add('panning'); }
      } else if (!g.touch && moved > MOUSE_SLOP) g.mode = 'box';
    }
    if (g.mode === 'pan') {
      S.cam.x -= (p.x - g.lx) / S.cam.z; S.cam.y -= (p.y - g.ly) / S.cam.z;
    }
    g.lx = p.x; g.ly = p.y;
    if (g.mode === 'box') S.preview = boxWinners(worldBox(g));
  }

  function onUp(e) {
    delete S.pts[e.pointerId];
    var g = S.g;
    cv.classList.remove('panning');
    if (!g) return;
    if (g.mode === 'pinch') { if (Object.keys(S.pts).length === 0) S.g = null; return; }
    if (e.pointerId !== g.id) return;
    cancelHold();
    var mod = g.mod || modOn(e);
    if (g.mode === 'wait' && e.type !== 'pointercancel') {
      var w = toWorld(g.sx, g.sy);
      doClick(w.x, w.y, mod);
    } else if (g.mode === 'box' && e.type !== 'pointercancel') {
      if (Math.hypot(g.cx - g.sx, g.cy - g.sy) > 3) doBox(worldBox(g), mod);
      else { var w2 = toWorld(g.sx, g.sy); doClick(w2.x, w2.y, mod); }
    }
    S.g = null; S.preview = null;
    $('press').className = '';
    updateReadout();
  }
  function cancelHold() { if (S.g && S.g.timer) { clearTimeout(S.g.timer); S.g.timer = null; } if (!(S.g && S.g.armed)) $('press').className = ''; }
  function worldBox(g) {
    var a = toWorld(Math.min(g.sx, g.cx), Math.min(g.sy, g.cy));
    var b = toWorld(Math.max(g.sx, g.cx), Math.max(g.sy, g.cy));
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }

  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && !S.g) S.hover = null; });
  cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // Wheel zoom at the cursor. The invert-scroll choice from the Controls page
  // (same origin, same key) flips the direction.
  cv.addEventListener('wheel', function (e) {
    e.preventDefault();
    var inv = false;
    try { inv = localStorage.getItem('stnv_invert_scroll') === '1'; } catch (err) { /* storage off */ }
    var d = e.deltaY * (e.deltaMode === 1 ? 16 : 1) * (inv ? -1 : 1);
    var p = local(e);
    zoomAt(p.x, p.y, S.cam.z * Math.exp(-d * 0.0015));
  }, { passive: false });

  // Keyboard: Ctrl or Cmd held is the modifier; R resets; + and - zoom;
  // 1 to 6 pick a lesson.
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Control' || e.key === 'Meta') { S.kbMod = true; syncAdd(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'r' || e.key === 'R') loadLesson(S.lesson);
    else if (e.key === '+' || e.key === '=') zoomAt(W / 2, H / 2, S.cam.z * 1.25);
    else if (e.key === '-' || e.key === '_') zoomAt(W / 2, H / 2, S.cam.z / 1.25);
    else if (/^[1-6]$/.test(e.key)) loadLesson(+e.key - 1);
  });
  window.addEventListener('keyup', function (e) { if (e.key === 'Control' || e.key === 'Meta') { S.kbMod = false; syncAdd(); } });
  window.addEventListener('blur', function () { S.kbMod = false; syncAdd(); });

  // ── dock and sheet ─────────────────────────────────────────────────────
  function syncAdd() {
    var on = S.add || S.kbMod;
    $('bAdd').setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  $('bAdd').addEventListener('click', function () { S.add = !S.add; syncAdd(); flash(S.add ? 'Add is on: picks add or remove' : 'Add is off', 'info'); });
  $('bBox').addEventListener('click', function () {
    S.boxMode = !S.boxMode;
    $('bBox').setAttribute('aria-pressed', S.boxMode ? 'true' : 'false');
    flash(S.boxMode ? 'Drag now draws a box' : 'Drag pans, hold then drag boxes', 'info');
  });
  $('bIn').addEventListener('click', function () { zoomAt(W / 2, H / 2, S.cam.z * 1.3); });
  $('bOut').addEventListener('click', function () { zoomAt(W / 2, H / 2, S.cam.z / 1.3); });
  $('bReset').addEventListener('click', function () { loadLesson(S.lesson); });
  function sheet(open) { document.body.classList.toggle('sheet-open', open); $('bLesson').setAttribute('aria-expanded', open ? 'true' : 'false'); }
  $('bLesson').addEventListener('click', function () { sheet(!document.body.classList.contains('sheet-open')); });
  $('grip').addEventListener('click', function () { sheet(false); });
  $('scrim').addEventListener('click', function () { sheet(false); });

  // ── readout and toast ──────────────────────────────────────────────────
  // Name the one selected category (or the module name for one module), with
  // a small thumbnail drawn by the same code as the canvas.
  function updateReadout() {
    var sel = ents.filter(function (e) { return e.sel; });
    var ro = $('readout');
    if (!sel.length) { ro.className = 'glass'; ro.innerHTML = '<span class="ro-empty">Nothing selected</span>'; }
    else {
      var t = TYPES[sel[0].type];
      var name = sel.length === 1 && sel[0].type === 'module' ? sel[0].name : (sel.length > 1 ? t.plural : t.label);
      ro.className = 'glass has';
      ro.innerHTML = '';
      ro.appendChild(thumb(sel[0].type, sel[0]));
      var s = document.createElement('span');
      s.innerHTML = '<b>' + sel.length + '</b> ' + esc(name) + ' selected';
      ro.appendChild(s);
    }
    highlightLadders(sel.length ? sel[0].type : null);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var toastT;
  function flash(msg, kind) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'show ' + (kind || '');
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.className = kind || ''; }, 1500);
  }

  // ── draw ───────────────────────────────────────────────────────────────
  // Size the backing store to the stage and the device pixel ratio, and lay
  // a fresh field of background dots.
  function resize() {
    var r = $('stage').getBoundingClientRect();
    var nw = Math.round(r.width), nh = Math.round(r.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (nw === W && nh === H && cv.width === Math.round(nw * dpr)) return;
    W = nw; H = nh;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    stars = [];
    var n = Math.round(W * H / 5000);
    for (var i = 0; i < n; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, a: rnd(0.08, 0.5), s: Math.random() < 0.1 ? 1.4 : 0.8 });
  }

  function drawPlanet(c, e, x, y, R) {
    var im = IMG[e.img];
    c.save();
    c.beginPath(); c.arc(x, y, R, 0, 6.283); c.clip();
    c.fillStyle = '#0d1424'; c.fillRect(x - R, y - R, 2 * R, 2 * R);
    if ('filter' in c) c.filter = 'brightness(1.7) saturate(1.15)';
    if (ok(im)) {
      // The front half of the texture map, in vertical strips. Each strip
      // takes the longitude at its screen x, so the surface curves at the rim.
      var tw = im.naturalWidth, th = im.naturalHeight, N = 28;
      var ph = (e.phase + S.t * e.spinRate) % 1;
      for (var i = 0; i < N; i++) {
        var x0 = -1 + 2 * i / N, x1 = -1 + 2 * (i + 1) / N;
        var u0 = (Math.asin(x0) / 6.283 + ph + 1) % 1 * tw;
        var uw = (Math.asin(x1) - Math.asin(x0)) / 6.283 * tw;
        var dx = x + x0 * R, dw = (x1 - x0) * R + 0.6;
        if (u0 + uw <= tw) c.drawImage(im, u0, 0, uw, th, dx, y - R, dw, 2 * R);
        else {
          var a = tw - u0, f = a / uw;
          c.drawImage(im, u0, 0, a, th, dx, y - R, dw * f, 2 * R);
          c.drawImage(im, 0, 0, uw - a, th, dx + dw * f, y - R, dw * (1 - f), 2 * R);
        }
      }
    } else { c.fillStyle = '#2d4a3a'; c.fillRect(x - R, y - R, 2 * R, 2 * R); }
    if ('filter' in c) c.filter = 'none';
    var g = c.createRadialGradient(x - R * 0.4, y - R * 0.45, R * 0.1, x, y, R * 1.05);
    g.addColorStop(0, 'rgba(255,255,255,0.14)'); g.addColorStop(0.6, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.6)');
    c.fillStyle = g; c.fillRect(x - R, y - R, 2 * R, 2 * R);
    c.restore();
    var at = c.createRadialGradient(x, y, R * 0.92, x, y, R * 1.18);
    at.addColorStop(0, 'rgba(150,200,255,0.35)'); at.addColorStop(1, 'rgba(150,200,255,0)');
    c.fillStyle = at; c.beginPath(); c.arc(x, y, R * 1.18, 0, 6.283); c.arc(x, y, R * 0.92, 0, 6.283, true); c.fill();
  }

  function drawStar(c, e, x, y, R) {
    var tw = 0.85 + 0.15 * Math.sin(S.t * 0.002 + e.tw);
    var g = c.createRadialGradient(x, y, 0, x, y, R * 1.6);
    g.addColorStop(0, 'rgba(255,250,230,' + tw + ')'); g.addColorStop(0.18, 'rgba(255,224,140,0.85)');
    g.addColorStop(0.5, 'rgba(255,180,80,0.18)'); g.addColorStop(1, 'rgba(255,160,60,0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, R * 1.6, 0, 6.283); c.fill();
    c.strokeStyle = 'rgba(255,236,180,' + (0.35 * tw) + ')'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x - R * 1.5, y); c.lineTo(x + R * 1.5, y); c.moveTo(x, y - R * 1.5); c.lineTo(x, y + R * 1.5); c.stroke();
  }

  function drawSprite(c, im, x, y, size, rot) {
    if (!ok(im) && !(im && im.getContext)) return false;
    var w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, k = size / Math.max(w, h);
    c.save(); c.translate(x, y); if (rot) c.rotate(rot);
    c.drawImage(im, -w * k / 2, -h * k / 2, w * k, h * k);
    c.restore();
    return true;
  }

  function drawStation(c, st, z) {
    var p = toScreen(st.x, st.y), h = CELL * 1.5 * z;
    c.fillStyle = 'rgba(150,200,255,0.05)';
    c.strokeStyle = S.split ? 'rgba(150,200,255,0.10)' : 'rgba(255,200,50,0.28)';
    c.lineWidth = 1;
    roundRect(c, p.x - h - 4, p.y - h - 4, 2 * h + 8, 2 * h + 8, 8 * Math.min(z, 1.5));
    c.fill(); c.stroke();
  }

  function drawEntity(c, e) {
    var p = toScreen(e.x, e.y), z = S.cam.z, R = e.r * z;
    if (p.x < -R * 3 || p.y < -R * 3 || p.x > W + R * 3 || p.y > H + R * 3) return;
    if (e.type === 'planet') drawPlanet(c, e, p.x, p.y, R);
    else if (e.type === 'star') drawStar(c, e, p.x, p.y, R);
    else if (e.type === 'station') drawStation(c, e, z);
    else if (e.type === 'module') {
      if (!drawSprite(c, IMG[e.img], p.x, p.y, CELL * z * 0.94, 0)) { c.fillStyle = '#3a4866'; c.fillRect(p.x - R, p.y - R, 2 * R, 2 * R); }
    } else if (e.type === 'asteroid') {
      if (!drawSprite(c, IMG[e.img], p.x, p.y, R * 2.3, e.rot)) { c.fillStyle = '#7a6a58'; c.beginPath(); c.arc(p.x, p.y, R, 0, 6.283); c.fill(); }
    } else {
      var shipC = SHIP[e.type];
      if (!drawSprite(c, shipC, p.x, p.y, R * 3, e.rot + Math.PI / 2)) {
        c.fillStyle = TYPES[e.type].color; c.beginPath(); c.arc(p.x, p.y, R * 0.6, 0, 6.283); c.fill();
      }
      if (e.type === 'enemy') { c.strokeStyle = 'rgba(255,120,110,0.55)'; c.lineWidth = 1; c.beginPath(); c.arc(p.x, p.y, R * 1.15, 0, 6.283); c.stroke(); }
    }
  }

  // Corner brackets round an entity. solid for the selection, dashed for a
  // hover or box preview.
  function reticle(c, e, color, solid) {
    var p = toScreen(e.x, e.y), z = S.cam.z;
    var h = (e.type === 'module' ? CELL / 2 : e.type === 'station' ? CELL * 1.5 + 4 : e.r * 1.12) * z + 4;
    var age = e.pulse != null ? S.t - e.pulse : 1e9;
    if (age < 260) h += (1 - age / 260) * 10;
    var k = Math.max(5, h * 0.42);
    c.save();
    c.strokeStyle = color; c.lineWidth = solid ? 2 : 1.4;
    if (solid) { c.shadowColor = color; c.shadowBlur = 10; } else c.setLineDash([3, 3]);
    c.beginPath();
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (s) {
      var cx = p.x + s[0] * h, cy = p.y + s[1] * h;
      c.moveTo(cx, cy - s[1] * k); c.lineTo(cx, cy); c.lineTo(cx - s[0] * k, cy);
    });
    c.stroke();
    c.restore();
    if (solid && e.type === 'module' && S.split) label(c, e.name, p.x, p.y + h + 13, color);
  }
  function label(c, text, x, y, color) {
    c.save();
    c.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
    var w = c.measureText(text).width + 12;
    c.fillStyle = 'rgba(10,12,18,0.85)'; roundRect(c, x - w / 2, y - 10, w, 18, 9); c.fill();
    c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x, y);
    c.restore();
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  // Move drifters and orbiters, wrapping drifters inside the lesson area.
  function step(dt) {
    ents.forEach(function (e) {
      if (e.orbit) {
        e.orbit.a += e.orbit.w * dt;
        e.x = e.orbit.cx + Math.cos(e.orbit.a) * e.orbit.rad; e.y = e.orbit.cy + Math.sin(e.orbit.a) * e.orbit.rad;
        e.rot = e.orbit.a + Math.PI / 2;
        return;
      }
      e.x += e.vx * dt * 0.06; e.y += e.vy * dt * 0.06; e.rot += e.spin * dt * 0.06;
      if (e.vx || e.vy) {
        if (e.x < -20) e.x = W + 20; else if (e.x > W + 20) e.x = -20;
        if (e.y < Y0 - 30) e.y = Y1 + 30; else if (e.y > Y1 + 30) e.y = Y0 - 30;
      }
    });
  }

  var last = 0;
  function frame(now) {
    var dt = last ? Math.min(50, now - last) : 16; last = now;
    S.t = now;
    resize();
    step(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // background dots and a world grid that pans and zooms with the camera
    stars.forEach(function (s) { ctx.fillStyle = 'rgba(200,220,255,' + s.a + ')'; ctx.fillRect(s.x, s.y, s.s, s.s); });
    var gs = 80 * S.cam.z, o = toScreen(0, 0);
    ctx.strokeStyle = 'rgba(150,200,255,0.035)'; ctx.lineWidth = 1; ctx.beginPath();
    for (var gx = ((o.x % gs) + gs) % gs; gx < W; gx += gs) { ctx.moveTo(gx, 0); ctx.lineTo(gx, H); }
    for (var gy = ((o.y % gs) + gs) % gs; gy < H; gy += gs) { ctx.moveTo(0, gy); ctx.lineTo(W, gy); }
    ctx.stroke();

    DRAW_ORDER.forEach(function (t) { ents.forEach(function (e) { if (e.type === t) drawEntity(ctx, e); }); });

    var ac = LESSONS[S.lesson].accent;
    if (S.hover && !S.hover.sel && live(S.hover)) reticle(ctx, S.hover, 'rgba(238,243,251,0.6)', false);
    if (S.preview) S.preview.forEach(function (e) { reticle(ctx, e, ac, false); });
    ents.forEach(function (e) { if (e.sel && live(e)) reticle(ctx, e, ac, true); });

    var g = S.g;
    if (g && g.mode === 'box') {
      var x = Math.min(g.sx, g.cx), y = Math.min(g.sy, g.cy), w = Math.abs(g.cx - g.sx), h = Math.abs(g.cy - g.sy);
      ctx.fillStyle = 'rgba(150,200,255,0.07)'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = ac; ctx.lineWidth = 1.2; ctx.setLineDash([6, 4]); ctx.strokeRect(x + 0.5, y + 0.5, w, h); ctx.setLineDash([]);
      if (S.preview && S.preview.length) label(ctx, S.preview.length + ' ' + (S.preview.length > 1 ? TYPES[S.preview[0].type].plural : TYPES[S.preview[0].type].label), x + w / 2, y + h + 14, ac);
    }
    requestAnimationFrame(frame);
  }

  // ── ladders ────────────────────────────────────────────────────────────
  // A small canvas with one sample of a type, drawn by the canvas code.
  function thumb(type, sample) {
    var c = document.createElement('canvas'), N = 30, k = Math.min(window.devicePixelRatio || 1, 2);
    c.width = c.height = N * k;
    var x = c.getContext('2d'); x.scale(k, k);
    var e = sample || SAMPLES[type];
    if (!e) return c;
    if (type === 'planet') drawPlanet(x, e, N / 2, N / 2, 12);
    else if (type === 'star') drawStar(x, e, N / 2, N / 2, 8);
    else if (type === 'station') {
      SPRITES.station.forEach(function (row, ri) { row.forEach(function (id, ci) { var en = BYID[id]; if (en) drawSprite(x, IMG[en.sprites[0]], N / 2 + (ci - 1) * 9, N / 2 + (ri - 1) * 9, 8.6, 0); }); });
    } else if (type === 'module') drawSprite(x, IMG[e.img], N / 2, N / 2, 24, 0);
    else if (type === 'asteroid') drawSprite(x, IMG[e.img], N / 2, N / 2, 24, 0.4);
    else drawSprite(x, SHIP[type], N / 2, N / 2, 30, 0);
    return c;
  }
  var SAMPLES = {};
  function buildLadders() {
    SAMPLES = {
      planet: { img: spritesOf('planets/terran')[0], phase: 0.2, spinRate: 0 },
      star: { tw: 0 },
      module: { img: spritesOf('modules/foundry')[0] },
      asteroid: { img: spritesOf(SPRITES.ores[0] || '')[0] },
      ship: {}, enemy: {}, station: {}
    };
    [['ladClick', 'click'], ['ladBox', 'box']].forEach(function (pair) {
      var ol = $(pair[0]); ol.innerHTML = '';
      Object.keys(TYPES).sort(function (a, b) { return TYPES[a][pair[1]] - TYPES[b][pair[1]]; }).forEach(function (t, i) {
        var li = document.createElement('li');
        li.dataset.type = t;
        li.appendChild(thumb(t));
        var n = document.createElement('span'); n.textContent = TYPES[t].label; li.appendChild(n);
        var rk = document.createElement('span'); rk.className = 'rk'; rk.textContent = '#' + (i + 1); li.appendChild(rk);
        ol.appendChild(li);
      });
    });
  }
  function highlightLadders(type) {
    document.querySelectorAll('.ladder li').forEach(function (li) { li.classList.toggle('hot', li.dataset.type === type); });
  }

  function buildTabs() {
    var nav = $('tabs');
    nav.setAttribute('role', 'tablist');
    LESSONS.forEach(function (L, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'tab'; b.setAttribute('role', 'tab');
      b.style.setProperty('--tc', L.accent);
      b.innerHTML = '<span class="n">' + pad(i + 1) + '</span><span class="t">' + esc(L.name) + '</span>';
      b.addEventListener('click', function () { loadLesson(i); });
      nav.appendChild(b);
    });
  }

  // ── boot ───────────────────────────────────────────────────────────────
  function boot() {
    buildTabs();
    var start = 0;
    try { var v = parseInt(localStorage.getItem('sn_selection_lesson'), 10); if (v >= 0 && v < LESSONS.length) start = v; } catch (e) { /* storage off */ }
    resize();
    loadLesson(start);
    requestAnimationFrame(frame);
    loadSprites(function () {
      SHIP.ship = tintShip(['#b8d8ff', '#7fe8ff', '#ffc832']);
      SHIP.enemy = tintShip(['#ff9a90', '#ffb070', '#ff5050']);
      buildLadders();
      updateReadout();
    });
    window.addEventListener('resize', function () { var oW = W, oH = H; resize(); if (Math.abs(W - oW) > 80 || Math.abs(H - oH) > 160) loadLesson(S.lesson); });
  }
  window.__snSelection = { S: S, ents: function () { return ents; }, loadLesson: loadLesson, toScreen: toScreen, zoomAt: zoomAt };
  boot();
})();
