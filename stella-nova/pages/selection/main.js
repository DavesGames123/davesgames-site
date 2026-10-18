// ============================================================================
//  SELECTION  ·  interactive tutorial for click, box and modifier selection
// ----------------------------------------------------------------------------
//  A 2D canvas sandbox. Six lessons put real game sprites on the canvas:
//  ships (the livery layers, tinted) and a station made of module sprites,
//  plus planets (Planet Forge textures on a sphere) and procedural rocky
//  asteroids. The input layer then shows how a click and a box resolve
//  when things overlap.
//
//  The sprites come from window.SN_DATA (lib/game-data/catalog.js). This file
//  has no game code. The two priority ladders below are the teaching content
//  of this page, not values from the game source.
//
//  LIGHT  Each lesson has one sun (the one 'star' entity, S.sun). Every
//  ship, module, asteroid and planet is shaded by the direction from it to
//  that sun (light.js). A sprite gets a normal map once (from its alpha and
//  luminance); its shaded copies are cached per light-angle bin and level
//  of detail in an LRU of canvases (litCanvas), and two bins blend while a
//  sprite turns. A planet is shaded per pixel into its own canvas when its
//  spin moves a texel (planetCanvas). If the browser blocks getImageData
//  (file://), the page draws the sprites unlit.
//
//  RETICLE  reticle.js gives the bracket geometry in screen space, so the
//  marks stay sharp at any zoom: selected, hover and box-preview states,
//  a colour per entity type, and the drag box.
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
//      planet list .......... "const PLANETS"       baked forge textures
//      lit sprite cache ..... "function litCanvas"  bins, LOD, LRU
//      sprite sources ....... "function buildSources"
//      planet render ........ "function planetCanvas"
//      sun .................. "function placeSun", "function drawSun"
//      reticles ............. "function drawReticle", "function drawDragBox"
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
//      screensaver .......... "window.snSaver"      shell saver autopilot
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
    livery: ['ship-livery/hull', 'ship-livery/cockpit', 'ship-livery/accents'],
    // Station layout, row by row. Each cell is one module sprite. Use only
    // ids that the catalog keeps. A missing id draws a plain square.
    station: [
      ['modules/hopper', 'modules/foundry', 'modules/assembler'],
      ['modules/docking', 'modules/structure-core', 'modules/fuel-processor'],
      ['modules/hydroponics-bed', 'modules/research-bench', 'modules/thruster']
    ]
  };

  // Planets: textures baked by bake-planets.mjs from the site's Planet Forge
  // (pages/forge). atm is the atmosphere colour (linear RGB) and k its
  // strength; tilt turns the spin axis; gain brightens a dark albedo.
  var PLANETS = [
    { id: 'earth', tex: 'planets/earth.webp', nrm: 'planets/earth-n.webp', atm: [0.25, 0.5, 1.0], k: 0.9, tilt: 0.38 },
    { id: 'rust', tex: 'planets/rust.webp', nrm: 'planets/rust-n.webp', atm: [0.9, 0.55, 0.35], k: 0.35, tilt: -0.3 },
    { id: 'ice', tex: 'planets/ice.webp', nrm: 'planets/ice-n.webp', atm: [0.6, 0.8, 1.0], k: 0.45, tilt: 0.2 },
    { id: 'moon', tex: 'planets/moon.webp', nrm: 'planets/moon-n.webp', atm: null, k: 0, tilt: 0.1, gain: 1.7 }
  ];
  var ROCKS = 10;          // asteroid shapes (light.js asteroid seeds)

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
  // and touch copy (nameTouch, headTouch, descTouch, notesTouch) where the
  // mouse copy says click or names a key. The touch copy uses only the
  // touch input below: tap, hold then drag, the Box and Add toggles, pinch.
  // and a setup() that fills ents. setup() runs in world units where the
  // visible area is the box (0,0)-(W,H) at zoom 1.
  var LESSONS = [
    {
      id: 'basics', name: 'Click & Box', accent: '#96c8ff',
      head: 'Click &amp; <em>Box</em>',
      desc: 'Click one entity to select it. Drag a rectangle to select many at once.',
      notes: ['Left-click any entity to select it.', 'Click and drag in empty space to draw a box.', 'Click empty space to clear.'],
      nameTouch: 'Tap & Box', headTouch: 'Tap &amp; <em>Box</em>',
      descTouch: 'Tap one entity to select it. Hold, then drag a rectangle to select many at once.',
      notesTouch: ['Tap any entity to select it.', 'Hold until the ring fills, then drag to draw a box. With <strong>Box</strong> on in the dock, a plain drag draws one.', 'Tap empty space to clear.'],
      hint: 'Click any ship, then <strong>drag a box</strong> around several asteroids.',
      hintTouch: 'Tap a ship. Then <strong>hold and drag</strong> a box around some asteroids.',
      setup: function () {
        placeSun(0); spawn('ship', 8, 'wide'); spawn('enemy', 3, 'wide');
        spawn('asteroid', 60, 'wide'); spawn('planet', 2, 'wide');
      }
    },
    {
      id: 'priority', name: 'Priority', accent: '#7ee08a',
      head: 'Overlap <em>Priority</em>',
      desc: 'When entities sit on top of each other, the system picks the one you probably meant.',
      notesTouch: ['A ship on a planet: a tap gets the <code>ship</code>.', 'You rarely want the bigger background object.', 'The same applies to ships on stations and asteroids on planets.'],
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
        placeSun(1); spawn('asteroid', 50, 'wide');
      }
    },
    {
      id: 'clickbox', name: 'Click vs Box', accent: '#ffa860',
      head: 'Click <em>vs</em> Box',
      desc: 'Clicking and box-dragging use different priorities. Clicking favours small useful things. Boxing favours the big important ones.',
      nameTouch: 'Tap vs Box', headTouch: 'Tap <em>vs</em> Box',
      descTouch: 'Taps and boxes use different priorities. A tap favours small useful things. A box favours the big important ones.',
      notesTouch: ['Tap in a busy area: you get a <code>ship</code>.', 'Box over the same area: you get the <code>planet</code> instead.', 'A box over a system should take the planets, not every ship that orbits them.'],
      notes: ['Click in a busy area: you get a <code>ship</code>.', 'Box over the same area: you get the <code>planet</code> instead.', 'A box over a system should take the planets, not every ship that orbits them.'],
      hint: '<strong>Click a ship</strong> in the ring, then <strong>box-drag</strong> over the planet. The result differs.',
      hintTouch: '<strong>Tap a ship</strong> in the ring, then <strong>hold and drag</strong> over the planet. The result differs.',
      setup: function () {
        var px = W * (narrow() ? 0.5 : 0.4), py = Y0 + (Y1 - Y0) * 0.55;
        placeSun(2);
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
      nameTouch: 'Add', headTouch: 'The <em>Add</em> toggle',
      descTouch: 'Turn on Add in the dock to add to your selection. With Add on, tap an entity that is already selected to remove only that one.',
      notesTouch: ['Turn on <strong>Add</strong> in the dock, then tap: adds to the selection.', 'With <strong>Add</strong> on, tap a selected entity: removes it.', 'With a keyboard, <code>Cmd</code> or <code>Ctrl</code> does the same as <strong>Add</strong>.'],
      notes: ['Hold <code>Cmd</code> or <code>Ctrl</code> and click: adds to the selection.', 'Click a selected entity with the modifier: removes it.', 'Touch: turn on <strong>Add</strong> in the dock. It acts as a held modifier.'],
      hint: 'Click a ship, then <code>Ctrl</code>/<code>Cmd</code>-click more. Then modifier-click a selected one to remove it.',
      hintTouch: 'Tap a ship. Turn on <strong>Add</strong> and tap more. Tap a selected one to remove it.',
      setup: function () { placeSun(3); spawn('ship', 12, 'wide'); spawn('enemy', 4, 'wide'); spawn('asteroid', 30, 'wide'); }
    },
    {
      id: 'lock', name: 'Category Lock', accent: '#c8a0ff',
      head: 'Category <em>Lock</em>',
      desc: 'You can never mix types in one selection. A new category replaces the old one, even with the modifier held.',
      descTouch: 'You can never mix types in one selection. A new category replaces the old one, even with Add on.',
      notesTouch: ['A selection is always one category.', 'Tap a different type: the previous selection drops out.', 'With <strong>Add</strong> on, tap empty space: nothing changes (safe).'],
      notes: ['A selection is always one category.', 'Click a different type: the previous selection drops out.', 'Modifier-click on empty space: nothing changes (safe).'],
      hint: 'Select some ships, then click an asteroid. <strong>The ships are released.</strong>',
      hintTouch: 'Select some ships, then tap an asteroid. <strong>The ships are released.</strong>',
      setup: function () { placeSun(4); spawn('ship', 9, 'left'); spawn('asteroid', 40, 'right'); spawn('enemy', 3, 'wide'); spawn('planet', 2, 'wide'); }
    },
    {
      id: 'modules', name: 'Zoom & Modules', accent: '#6fe0e8',
      head: 'Zoom &amp; <em>Modules</em>',
      desc: 'Zoom in past the threshold and a station splits into its modules. Each module then takes clicks of its own.',
      descTouch: 'Zoom in past the threshold and a station splits into its modules. Each module then takes taps of its own.',
      notes: ['Low zoom: the station is one entity.', 'High zoom: each module is its own entity.', 'The threshold has hysteresis, so there is no flicker at the edge.'],
      hint: 'Zoom in with the wheel or <code>+</code>. The station splits into modules. Click a module.',
      hintTouch: 'Pinch or tap <strong>+</strong> to zoom in. The station splits into modules. Tap a module.',
      setup: function () {
        placeSun(5);
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
  var SRC = {};       // sprite sources for the light cache (buildSources)
  var PTEX = {};      // planet id -> { tex: mip levels, nrm: mip levels }
  var stars = [];     // background dots in screen space
  var LT = window.SNLight, RT = window.SNReticle;
  var LIT_OK = !!LT;  // false when getImageData is blocked (file://)
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
  // Planet textures live in this page folder (planets/). Each one is read
  // back to pixels once and halved into mip levels.
  function loadPlanets(done) {
    var left = 0;
    PLANETS.forEach(function (P) {
      [['tex', P.tex], ['nrm', P.nrm]].forEach(function (pair) {
        if (!pair[1]) return;
        left++;
        var im = new Image();
        im.onload = function () {
          var px = pixels(im, im.naturalWidth, im.naturalHeight);
          if (px && pair[0] === 'tex' && P.gain) for (var i = 0; i < px.data.length; i++) if ((i & 3) !== 3) px.data[i] = Math.min(255, px.data[i] * P.gain);
          if (px) (PTEX[P.id] = PTEX[P.id] || {})[pair[0]] = LT.mipChain({ w: px.width, h: px.height, data: px.data }, 32);
          if (--left === 0) done();
        };
        im.onerror = function () { if (--left === 0) done(); };
        im.src = pair[1];
      });
    });
    if (!left) done();
  }
  // RGBA pixels of an image or canvas at w x h, or null when the browser
  // blocks the read (a tainted canvas on file://).
  function pixels(src, w, h) {
    if (!LIT_OK || !w || !h) return null;
    try {
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var x = c.getContext('2d'); x.drawImage(src, 0, 0, w, h);
      return x.getImageData(0, 0, w, h);
    } catch (err) { LIT_OK = false; return null; }
  }
  function ok(im) { return im && im.complete && im.naturalWidth > 0; }

  // Compose the three livery layers into one ship canvas. Each layer is
  // multiplied by its tint where its mask is white. The colour layer alpha
  // then trims the result. Compositing only, so it also works from file://.
  function tintShip(tints, size) {
    var N = size || 160, c = document.createElement('canvas');
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
      e.rock = (Math.random() * ROCKS) | 0;
      e.r = rnd(9, 16); e.spin = rnd(-0.006, 0.006); e.vx = rnd(-0.05, 0.05); e.vy = rnd(-0.05, 0.05);
    }
    if (type === 'planet') {
      e.planet = nextPlanet(); e.r = rnd(30, 40); e.phase = rnd(0, 1);
      e.spinRate = rnd(0.000008, 0.000016) * (Math.random() < 0.5 ? -1 : 1);
      e.tilt = e.planet.tilt + rnd(-0.15, 0.15);
    }
    if (type === 'star') { e.tw = rnd(0, 6.283); e.r = 24; }
    e.ph = rnd(0, 6.283);   // reticle pulse phase
    return e;
  }

  // Planets come from a shuffled bag, so one lesson shows different worlds.
  var planetBag = [];
  function nextPlanet() {
    if (!planetBag.length) planetBag = PLANETS.slice().sort(function () { return Math.random() - 0.5; });
    return planetBag.pop();
  }

  // The one sun of a lesson, near a corner of the free area. Each lesson
  // takes another corner, so the light comes from another side. Call it
  // first in setup(), so the other entities keep clear of it.
  var SUN_SPOTS = [[0.1, 0.14], [0.08, 0.88], [0.9, 0.16], [0.1, 0.86], [0.92, 0.84], [0.88, 0.14]];
  function placeSun(i) {
    var q = SUN_SPOTS[i % SUN_SPOTS.length];
    var x = W * q[0], y = Y0 + (Y1 - Y0) * q[1];
    if (narrow()) x = W * (q[0] < 0.5 ? 0.12 : 0.88);
    var st = make('star', x, y);
    ents.push(st);
    S.sun = st;
    return st;
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
      var e = ents[i], gap = (type === 'asteroid' && e.type === 'asteroid') ? -4 : e.type === 'star' ? 30 : 6;
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
        m.img = en && en.sprites && en.sprites[0];
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
    S.lesson = i; S.g = null; S.split = false; S.station = null; S.hover = null; S.preview = null; S.sun = null;
    planetBag = [];
    resize();
    var stage = $('stage').getBoundingClientRect();
    var hint = $('hint');
    var L = LESSONS[i];
    hint.innerHTML = '<span class="hk">Task</span><span>' + (TOUCH ? L.hintTouch : L.hint) + '</span>';
    Y0 = Math.max(60, hint.getBoundingClientRect().bottom - stage.top + 10);
    var dockTop = $('dock').getBoundingClientRect().top - stage.top;
    Y1 = Math.min(H - 20, dockTop - 54);
    if (Y1 - Y0 < 160) Y1 = Math.min(H - 10, Y0 + 160);
    if (SV) { Y0 = H * 0.1; Y1 = H * 0.9; }
    if (!narrow()) $('toast').style.top = Y0 + 'px';
    S.cam = { x: W / 2, y: H / 2, z: 1 };
    ents = [];
    L.setup();
    document.documentElement.style.setProperty('--ac', L.accent);
    $('lsKicker').textContent = 'Lesson ' + pad(i + 1) + ' / ' + pad(LESSONS.length);
    $('lsHead').innerHTML = (TOUCH && L.headTouch) || L.head;
    $('lsDesc').textContent = (TOUCH && L.descTouch) || L.desc;
    $('lsNotes').innerHTML = ((TOUCH && L.notesTouch) || L.notes).map(function (n) { return '<li>' + n + '</li>'; }).join('');
    document.querySelectorAll('.tab').forEach(function (b, k) { b.classList.toggle('on', k === i); b.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
    var on = document.querySelector('.tab.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    if (!SV) try { localStorage.setItem('sn_selection_lesson', String(i)); } catch (e) { /* storage off */ }
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
      // the readout takes the bracket colour of the selected type
      if (RT && RT.COLORS[sel[0].type]) ro.style.setProperty('--ac', RT.COLORS[sel[0].type]);
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
    // dim points only: they light nothing
    for (var i = 0; i < n; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, a: rnd(0.05, 0.32), s: Math.random() < 0.08 ? 1.2 : 0.7 });
  }

  // ── lit sprite cache ───────────────────────────────────────────────────
  // A source is { key, sizes, lods, mat, gen }. gen(n) gives the level of
  // detail for side n: { w, h, rgba, nrm } (light.js arrays). litCanvas
  // gives that level shaded for one light bin, from an LRU of canvases.
  // New shades per frame are capped by pixel count (SHADE_BUDGET); over the
  // cap it gives null and the caller uses a ready bin or the unlit sprite.
  // New levels of detail per frame are capped too (GEN_BUDGET); lodOf then
  // gives a level that is ready.
  var BINS = 32, LRU = new Map(), LRU_PX = 0, LRU_MAX = 7e6;
  var SHADE_BUDGET = 90000, shadesLeft = SHADE_BUDGET, GEN_BUDGET = 1, gensLeft = GEN_BUDGET;
  var planetsLeft = 1;   // planet re-shades per frame
  function litCanvas(src, li, bin, force) {
    var key = src.key + '|' + li + '|' + bin, c = LRU.get(key);
    if (c) { LRU.delete(key); LRU.set(key, c); return c; }
    var d = src.lods[li];
    if (!d) return null;
    if (shadesLeft <= 0 && !force) return null;
    shadesLeft -= d.w * d.h;
    c = document.createElement('canvas'); c.width = d.w; c.height = d.h;
    var x = c.getContext('2d'), im = x.createImageData(d.w, d.h);
    LT.shade(d.rgba, d.nrm, d.w, d.h, LT.binLight(bin, BINS), LT.MATERIALS[src.mat], im.data);
    x.putImageData(im, 0, 0);
    LRU.set(key, c); LRU_PX += d.w * d.h;
    while (LRU_PX > LRU_MAX && LRU.size > 1) {
      var k0 = LRU.keys().next().value, c0 = LRU.get(k0);
      LRU.delete(k0); LRU_PX -= c0.width * c0.height;
    }
    return c;
  }
  // The level of detail for a draw of devPx device pixels (built on first
  // use). Returns -1 when the source has no pixels.
  function lodOf(src, devPx, force) {
    var i = 0;
    while (i < src.sizes.length - 1 && src.sizes[i] < devPx * 0.85) i++;
    if (src.lods[i] === undefined && (gensLeft > 0 || force)) { gensLeft--; src.lods[i] = src.gen(src.sizes[i]) || null; }
    if (src.lods[i]) return i;
    for (var j = 0; j < src.lods.length; j++) if (src.lods[j]) return j;
    return -1;
  }

  // ── sprite sources ─────────────────────────────────────────────────────
  // Ships and modules: normal maps from the sprite alpha and luminance.
  // Asteroids: light.js rocks, one per seed. Run after loadSprites.
  var TINTS = { ship: ['#b8d8ff', '#7fe8ff', '#ffc832'], enemy: ['#ff9a90', '#ffb070', '#ff5050'] };
  function spriteSource(key, sizes, draw, mat, bevel, detail) {
    return { key: key, sizes: sizes, lods: [], mat: mat, gen: function (n) {
      var c = draw(n), px = pixels(c, c.width, c.height);
      if (!px) return null;
      var hs = LT.spriteHeight(px.data, c.width, c.height, { bevel: n * bevel, detail: detail });
      return { w: c.width, h: c.height, rgba: px.data, nrm: LT.normalsFromHeight(hs.height, c.width, c.height, 1) };
    } };
  }
  // An image fitted into an n x n canvas, centred.
  function fitCanvas(im, n) {
    var c = document.createElement('canvas'); c.width = c.height = n;
    if (ok(im)) {
      var w = im.naturalWidth, h = im.naturalHeight, k = n / Math.max(w, h);
      c.getContext('2d').drawImage(im, (n - w * k) / 2, (n - h * k) / 2, w * k, h * k);
    }
    return c;
  }
  function buildSources() {
    SHIP.ship = tintShip(TINTS.ship);
    SHIP.enemy = tintShip(TINTS.enemy);
    if (!LT) return;
    ['ship', 'enemy'].forEach(function (t) {
      SRC[t] = spriteSource(t, [96, 192], function (n) { return tintShip(TINTS[t], n); }, 'hull', 0.09, 0.35);
    });
    SPRITES.station.forEach(function (row) {
      row.forEach(function (id) {
        var p = spritesOf(id)[0];
        if (p && ok(IMG[p])) SRC[p] = spriteSource(p, [48, 128], function (n) { return fitCanvas(IMG[p], n); }, 'module', 0.1, 0.2);
      });
    });
    for (var r = 0; r < ROCKS; r++) {
      (function (seed) {
        SRC['rock' + seed] = { key: 'rock' + seed, sizes: [48, 96, 128], lods: [], mat: 'rock', gen: function (n) { return LT.asteroid(seed + 1, n); } };
      })(r);
    }
    // the smallest level of each source now, so a first frame has one
    for (var k in SRC) lodOf(SRC[k], 0, true);
  }

  // The light on an entity: from it to the sun of the lesson.
  function sunLight(e, elev) {
    return S.sun ? LT.sunDir(e.x, e.y, S.sun.x, S.sun.y, elev) : LT.sunDir(1, 1, 0, 0, elev);
  }

  // Draw a source shaded for world light Lw at (x,y), size CSS px, turned
  // by rot. k is the device pixel ratio of the target. Two light bins blend
  // by the angle between them. False when nothing could be drawn.
  function drawLit(c, src, x, y, size, rot, Lw, k, force) {
    if (!LIT_OK || !src || !Lw) return false;
    var li = lodOf(src, size * k, force);
    if (li < 0) return false;
    var Ll = LT.localLight(Lw, rot), b = LT.lightBin(Ll.az, BINS);
    var c0 = litCanvas(src, li, b.i0, force), c1 = b.f > 0.03 ? litCanvas(src, li, b.i1, force) : null;
    // over budget: borrow a near bin that is ready
    for (var dk = 1; !c0 && !c1 && dk <= 4; dk++) c0 = LRU.get(src.key + '|' + li + '|' + ((b.i0 + dk) % BINS)) || LRU.get(src.key + '|' + li + '|' + ((b.i0 - dk + BINS) % BINS)) || null;
    if (!c0 && !c1) return false;
    c.save(); c.translate(x, y); if (rot) c.rotate(rot);
    var h = size / 2;
    if (c0) c.drawImage(c0, -h, -h, size, size);
    if (c1) { c.globalAlpha = c0 ? b.f : 1; c.drawImage(c1, -h, -h, size, size); }
    c.restore();
    return true;
  }

  // ── planet render ──────────────────────────────────────────────────────
  // A planet is shaded per pixel (light.js shadePlanet) into its own
  // canvas. The diameter in device pixels is quantised in steps of 12 %, so
  // a wheel zoom does not rebuild the table each frame. The canvas is shaded
  // again when the spin moves 1.5 texels or the light turns. One planet
  // shades per frame.
  function planetCanvas(e, devD, L, slot, force) {
    var tx = PTEX[e.planet && e.planet.id];
    if (!LIT_OK || !tx || !tx.tex) return null;
    var D = Math.max(12, Math.min(360, Math.round(Math.pow(1.12, Math.round(Math.log(Math.max(4, devD)) / Math.log(1.12))))));
    var pc = e[slot] || (e[slot] = {});
    if (pc.D !== D) {
      pc.D = D; pc.T = LT.planetTable(D, e.tilt || 0);
      pc.c = document.createElement('canvas'); pc.c.width = pc.c.height = pc.T.B;
      pc.x = pc.c.getContext('2d'); pc.img = pc.x.createImageData(pc.T.B, pc.T.B); pc.spin = null;
    }
    var tex = LT.mipTexture(tx.tex, D), nrm = tx.nrm ? LT.mipTexture(tx.nrm, D) : null;
    var spin = (e.phase || 0) + S.t * (e.spinRate || 0);
    var dirty = pc.spin == null || Math.abs(spin - pc.spin) * tex.w >= 1.5 || Math.abs(L.az - pc.az) > 0.004;
    if (dirty && (force || pc.spin == null || planetsLeft > 0)) {
      planetsLeft--;
      LT.shadePlanet(pc.T, tex, nrm, spin, L, e.planet.atm, e.planet.k, pc.img.data);
      pc.x.putImageData(pc.img, 0, 0);
      pc.spin = spin; pc.az = L.az;
    }
    return pc;
  }
  function drawPlanet(c, e, x, y, R, k, L, slot, force) {
    var pc = LIT_OK ? planetCanvas(e, 2 * R * k, L || sunLight(e, LT.ELEV_PLANET), slot || 'pc', force) : null;
    if (pc) {
      var s = 2 * R / pc.D * pc.T.B;
      c.drawImage(pc.c, x - s / 2, y - s / 2, s, s);
      return;
    }
    // unlit fallback: a shaded disc
    var g = c.createRadialGradient(x - R * 0.4, y - R * 0.4, R * 0.1, x, y, R);
    g.addColorStop(0, '#6f8fb0'); g.addColorStop(1, '#1a2533');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, R, 0, 6.283); c.fill();
  }

  // ── sun ────────────────────────────────────────────────────────────────
  // The one light source: a white-hot core with limb darkening, a warm
  // inner corona and a wide soft glow, drawn additive. R is the pick
  // radius; the core is about half of it.
  function drawSun(c, e, x, y, R) {
    var t = S.t * 0.001, fl = 1 + 0.025 * Math.sin(t * 1.3 + e.tw) + 0.015 * Math.sin(t * 2.9 + 1.7 * e.tw);
    var core = R * 0.5;
    c.save();
    c.globalCompositeOperation = 'lighter';
    var g = c.createRadialGradient(x, y, core * 0.5, x, y, R * 6 * fl);
    g.addColorStop(0, 'rgba(255,214,150,0.30)'); g.addColorStop(0.12, 'rgba(255,180,100,0.13)');
    g.addColorStop(0.35, 'rgba(255,140,70,0.04)'); g.addColorStop(1, 'rgba(255,120,60,0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, R * 6 * fl, 0, 6.283); c.fill();
    var g2 = c.createRadialGradient(x, y, core * 0.8, x, y, core * 2.6 * fl);
    g2.addColorStop(0, 'rgba(255,236,200,0.85)'); g2.addColorStop(0.4, 'rgba(255,196,120,0.28)'); g2.addColorStop(1, 'rgba(255,170,90,0)');
    c.fillStyle = g2; c.beginPath(); c.arc(x, y, core * 2.6 * fl, 0, 6.283); c.fill();
    // a faint horizontal flare, as a lens would make
    var g3 = c.createLinearGradient(x - R * 4, y, x + R * 4, y);
    g3.addColorStop(0, 'rgba(255,220,170,0)'); g3.addColorStop(0.5, 'rgba(255,230,190,0.16)'); g3.addColorStop(1, 'rgba(255,220,170,0)');
    c.fillStyle = g3; c.fillRect(x - R * 4, y - 0.6, R * 8, 1.2);
    c.globalCompositeOperation = 'source-over';
    var g4 = c.createRadialGradient(x - core * 0.15, y - core * 0.15, 0, x, y, core);
    g4.addColorStop(0, '#fffdf6'); g4.addColorStop(0.7, '#fff1cf'); g4.addColorStop(1, '#ffd690');
    c.fillStyle = g4; c.beginPath(); c.arc(x, y, core, 0, 6.283); c.fill();
    c.restore();
  }

  function drawSprite(c, im, x, y, size, rot) {
    if (!ok(im) && !(im && im.getContext)) return false;
    var w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, k = size / Math.max(w, h);
    c.save(); c.translate(x, y); if (rot) c.rotate(rot);
    c.drawImage(im, -w * k / 2, -h * k / 2, w * k, h * k);
    c.restore();
    return true;
  }
  // Unlit rock for file:// (getImageData blocked).
  function plainRock(c, x, y, R) {
    var g = c.createRadialGradient(x - R * 0.35, y - R * 0.35, R * 0.1, x, y, R);
    g.addColorStop(0, '#8a8078'); g.addColorStop(1, '#2e2a27');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, R, 0, 6.283); c.fill();
  }

  // One entity in screen space. The station itself draws nothing: its
  // modules draw it.
  function drawEntity(c, e) {
    var p = toScreen(e.x, e.y), z = S.cam.z, R = e.r * z, m = e.type === 'star' ? R * 6 : R * 3;
    if (p.x < -m || p.y < -m || p.x > W + m || p.y > H + m) return;
    if (e.type === 'station') return;
    if (e.type === 'planet') { drawPlanet(c, e, p.x, p.y, R, dpr); return; }
    if (e.type === 'star') { drawSun(c, e, p.x, p.y, R); return; }
    var L = LT ? sunLight(e) : null;
    if (e.type === 'module') {
      if (!drawLit(c, SRC[e.img], p.x, p.y, CELL * z * 0.94, 0, L, dpr) && !drawSprite(c, IMG[e.img], p.x, p.y, CELL * z * 0.94, 0)) { c.fillStyle = '#3a4866'; c.fillRect(p.x - R, p.y - R, 2 * R, 2 * R); }
    } else if (e.type === 'asteroid') {
      if (!drawLit(c, SRC['rock' + e.rock], p.x, p.y, R * 2.5, e.rot, L, dpr)) plainRock(c, p.x, p.y, R);
    } else if (!drawLit(c, SRC[e.type], p.x, p.y, R * 3, e.rot + Math.PI / 2, L, dpr) && !drawSprite(c, SHIP[e.type], p.x, p.y, R * 3, e.rot + Math.PI / 2)) {
      c.fillStyle = TYPES[e.type].color; c.beginPath(); c.arc(p.x, p.y, R * 0.6, 0, 6.283); c.fill();
    }
  }

  // ── reticles ───────────────────────────────────────────────────────────
  // Half size of the bracket box, in CSS px, for an entity at zoom z.
  function extentOf(e, z) {
    if (e.type === 'module') return CELL / 2 * z;
    if (e.type === 'station') return CELL * 1.5 * z;
    if (e.type === 'ship' || e.type === 'enemy') return e.r * 1.1 * z;
    if (e.type === 'star') return e.r * 0.7 * z;
    return e.r * z;
  }
  // Brackets round an entity in the state sel, hover or preview, in the
  // colour of its type, with an additive glow under a crisp core stroke.
  function drawReticle(c, e, state) {
    var p = toScreen(e.x, e.y);
    var g = RT.reticle(p.x, p.y, extentOf(e, S.cam.z), state, dpr, S.t, state === 'sel' ? e.pulse : null, e.ph || 0);
    var col = RT.COLORS[e.type] || '#ffffff', q = g.pts;
    c.save();
    c.beginPath();
    for (var i = 0; i < 24; i += 6) { c.moveTo(q[i], q[i + 1]); c.lineTo(q[i + 2], q[i + 3]); c.lineTo(q[i + 4], q[i + 5]); }
    if (g.glow > 0) {
      // soft bloom: two wide round strokes, added to what is under them
      c.globalCompositeOperation = 'lighter'; c.lineCap = 'round'; c.lineJoin = 'round';
      c.strokeStyle = RT.rgba(col, g.glow * 0.22); c.lineWidth = g.lw * 5; c.stroke();
      c.strokeStyle = RT.rgba(col, g.glow * 0.5); c.lineWidth = g.lw * 2.4; c.stroke();
      c.globalCompositeOperation = 'source-over';
    }
    c.lineCap = 'butt'; c.lineJoin = 'miter';
    c.strokeStyle = RT.rgba(col, g.alpha); c.lineWidth = g.lw; c.stroke();
    c.restore();
    if (state === 'sel' && e.type === 'module' && S.split) label(c, e.name, p.x, p.y + g.half + 13, col);
  }
  // The drag box: a crisp thin rect with a faint fill, and a label with
  // what the box takes.
  function drawDragBox(c, g) {
    var b = RT.dragBox(g.sx, g.sy, g.cx, g.cy, dpr);
    c.fillStyle = b.fill; c.fillRect(b.x, b.y, b.w, b.h);
    c.strokeStyle = b.stroke; c.lineWidth = b.lw; c.strokeRect(b.x, b.y, b.w, b.h);
    var pv = S.preview;
    if (pv && pv.length) label(c, pv.length + ' ' + (pv.length > 1 ? TYPES[pv[0].type].plural : TYPES[pv[0].type].label), b.x + b.w / 2, b.y + b.h + 14, RT.COLORS[pv[0].type] || b.stroke);
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
    if (SV) { dt *= SV.slow; saverTick(now); }
    step(dt);
    shadesLeft = SHADE_BUDGET; gensLeft = GEN_BUDGET; planetsLeft = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (SV) { var bg = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.max(W, H) * 0.75); bg.addColorStop(0, '#0f1422'); bg.addColorStop(1, '#07090f'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
    // background dots and a world grid that pans and zooms with the camera
    stars.forEach(function (s) { ctx.fillStyle = 'rgba(200,220,255,' + s.a + ')'; ctx.fillRect(s.x, s.y, s.s, s.s); });
    var gs = 80 * S.cam.z, o = toScreen(0, 0);
    ctx.strokeStyle = 'rgba(150,200,255,0.035)'; ctx.lineWidth = 1; ctx.beginPath();
    for (var gx = ((o.x % gs) + gs) % gs; gx < W; gx += gs) { ctx.moveTo(gx, 0); ctx.lineTo(gx, H); }
    for (var gy = ((o.y % gs) + gs) % gs; gy < H; gy += gs) { ctx.moveTo(0, gy); ctx.lineTo(W, gy); }
    ctx.stroke();

    DRAW_ORDER.forEach(function (t) { ents.forEach(function (e) { if (e.type === t) drawEntity(ctx, e); }); });

    if (RT) {
      if (S.hover && !S.hover.sel && live(S.hover)) drawReticle(ctx, S.hover, 'hover');
      if (S.preview) S.preview.forEach(function (e) { if (!e.sel) drawReticle(ctx, e, 'preview'); });
      ents.forEach(function (e) { if (e.sel && live(e)) drawReticle(ctx, e, 'sel'); });
      if (S.g && S.g.mode === 'box') drawDragBox(ctx, S.g);
    }
    if (SV && SV.fade > 0) { ctx.fillStyle = 'rgba(7,9,15,' + SV.fade + ')'; ctx.fillRect(0, 0, W, H); }
    requestAnimationFrame(frame);
  }

  // ── ladders ────────────────────────────────────────────────────────────
  // A small canvas with one sample of a type, drawn by the canvas code.
  // The legend light comes from the upper left, as from a sun there.
  function thumb(type, sample) {
    var c = document.createElement('canvas'), N = 30, k = Math.min(window.devicePixelRatio || 1, 2);
    c.width = c.height = N * k;
    var x = c.getContext('2d'); x.scale(k, k);
    var e = sample || SAMPLES[type];
    if (!e) return c;
    var L = LT ? LT.sunDir(1, 1, 0, 0) : null, h = N / 2;
    if (type === 'planet') drawPlanet(x, e, h, h, 12, k, LT && LT.sunDir(1, 1, 0, 0, LT.ELEV_PLANET), 'pcThumb', true);
    else if (type === 'star') drawSun(x, e, h, h, 11);
    else if (type === 'station') {
      SPRITES.station.forEach(function (row, ri) { row.forEach(function (id, ci) { var sp = spritesOf(id); if (sp[0] && !drawLit(x, SRC[sp[0]], h + (ci - 1) * 9, h + (ri - 1) * 9, 8.6, 0, L, k, true)) drawSprite(x, IMG[sp[0]], h + (ci - 1) * 9, h + (ri - 1) * 9, 8.6, 0); }); });
    } else if (type === 'module') { if (!drawLit(x, SRC[e.img], h, h, 24, 0, L, k, true)) drawSprite(x, IMG[e.img], h, h, 24, 0); }
    else if (type === 'asteroid') { if (!drawLit(x, SRC['rock' + e.rock], h, h, 30, 0.4, L, k, true)) plainRock(x, h, h, 10); }
    else if (!drawLit(x, SRC[type], h, h, 30, 0, L, k, true)) drawSprite(x, SHIP[type], h, h, 30, 0);
    return c;
  }
  var SAMPLES = {};
  function buildLadders() {
    SAMPLES = {
      planet: { planet: PLANETS[0], phase: 0.15, spinRate: 0, tilt: PLANETS[0].tilt },
      star: { tw: 0 },
      module: { img: spritesOf('modules/foundry')[0] },
      asteroid: { rock: 2 },
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
    if (TOUCH) {
      var card = $('ladClick').closest('.card');
      card.querySelector('h2').textContent = 'Tap priority';
      card.querySelector('.lad-sub').textContent = 'Lowest rank wins when several things sit under your finger.';
    }
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
      b.innerHTML = '<span class="n">' + pad(i + 1) + '</span><span class="t">' + esc((TOUCH && L.nameTouch) || L.name) + '</span>';
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
      buildSources();
      buildLadders();
      updateReadout();
      if (LT) loadPlanets(function () { buildLadders(); updateReadout(); });
    });
    window.addEventListener('resize', function () { var oW = W, oH = H; resize(); if (Math.abs(W - oW) > 80 || Math.abs(H - oH) > 160) loadLesson(S.lesson); });
  }
  // ── screensaver ────────────────────────────────────────────────────────
  // Shell saver hook (lib/screensaver.js). enter() hides the chrome, makes
  // #stage fill the window and plays three lessons per dwell. In each lesson
  // the autopilot alternates a slow box drag and a click, holds the result,
  // then clears it. The Modifier and Category Lock lessons use three clicks,
  // the second and third with the modifier. A fade to the stage colour hides each lesson respawn.
  // calm 1 slows the drift and the gestures. No localStorage write in saver.
  var SV = null;
  function saverTick(now) {
    var v = SV, t = now - v.t0;
    if (t >= v.seg) { v.t0 = now; t = 0; v.k = 0; v.act = null; v.li = (v.li + 1) % LESSONS.length; loadLesson(v.li); }
    v.fade = t < 900 ? 1 - t / 900 : t > v.seg - 900 ? (t - v.seg + 900) / 900 : 0;
    var sm = function (x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
    var c = S.station && S.lesson === 5 ? toScreen(S.station.x, S.station.y) : { x: W / 2, y: H / 2 };
    var zt = S.lesson === 5 ? 1.2 + 1.1 * sm(0.5 - 0.5 * Math.cos(t / v.seg * 2 * Math.PI)) : 1 + 0.1 * Math.sin(t / v.seg * Math.PI);
    zoomAt(c.x, c.y, zt);
    var a = v.act;
    if (!a) {
      if (t < 1200 || t > v.seg - 6000 * v.slow2) return;
      var pool = ents.filter(function (e) { return live(e) && toScreen(e.x, e.y).x > W * 0.15 && toScreen(e.x, e.y).x < W * 0.85; });
      if (!pool.length) return;
      var e = pool[(v.rng() * pool.length) | 0], p = toScreen(e.x, e.y);
      var many = S.lesson === 3 || S.lesson === 4;
      a = v.act = { box: !many && v.k % 2 === 0, mod: many && v.k % 3 !== 0, keep: many && v.k % 3 !== 2, e: e, t0: now };
      if (a.box) {
        var hw = W * (0.1 + 0.12 * v.rng()), hh = H * (0.1 + 0.1 * v.rng()), dx = (v.rng() - 0.5) * hw, dy = (v.rng() - 0.5) * hh;
        a.sx = p.x + dx - hw; a.sy = p.y + dy - hh; a.ex = p.x + dx + hw; a.ey = p.y + dy + hh;
        if (v.rng() < 0.5) { var q = a.sx; a.sx = a.ex; a.ex = q; }
      }
      v.k++;
    }
    var u = (now - a.t0) / v.slow2;
    if (a.box && u < 2200) {
      var f = sm(u / 2200);
      S.g = { mode: 'box', sx: a.sx, sy: a.sy, cx: a.sx + (a.ex - a.sx) * f, cy: a.sy + (a.ey - a.sy) * f };
      S.preview = boxWinners(worldBox(S.g));
    } else if (!a.box && u < 1200) S.hover = a.e;
    else if (!a.done) {
      a.done = true;
      if (a.box) { doBox(worldBox(S.g), false); S.g = null; S.preview = null; } else { S.hover = null; doClick(a.e.x, a.e.y, a.mod); }
      ents.forEach(function (e) { e.pulse = null; });
      updateReadout();
    } else if (u > (a.box ? 2200 : 1200) + 3000) {
      if (!a.keep) { ents.forEach(function (e) { e.sel = false; }); updateReadout(); }
      v.act = null;
    }
  }
  window.snSaver = {
    enter: function (opts) {
      var calm = Math.max(0, Math.min(1, +opts.calm || 0)), seed = (opts.seed >>> 0) || 1;
      var st = document.createElement('style');
      st.textContent = 'html.saver #tabs,html.saver #hint,html.saver #readout,html.saver #toast,html.saver #press,html.saver #dock,html.saver #lesson,html.saver #scrim{display:none!important}' +
        'html.saver #stage{position:fixed;inset:0}html.saver #cv{cursor:none}';
      document.head.appendChild(st);
      document.documentElement.classList.add('saver');
      SV = { slow: 1 - 0.6 * calm, slow2: 1 + 0.6 * calm, seg: Math.max(14000, (+opts.seconds || 60) * 1000 / 3), li: seed % LESSONS.length, k: 0, act: null, fade: 1, t0: performance.now(),
        rng: function () { seed = (seed + 0x6D2B79F5) >>> 0; var x = Math.imul(seed ^ seed >>> 15, 1 | seed); x ^= x + Math.imul(x ^ x >>> 7, 61 | x); return ((x ^ x >>> 14) >>> 0) / 4294967296; } };
      resize();
      loadLesson(SV.li);
      return { canvas: cv, warmupMs: 1500 };
    }
  };
  // Test hook (tests.mjs). setEnts replaces the entity list for a scripted
  // scene. No page code reads this object.
  window.__snSelection = {
    S: S, ents: function () { return ents; }, setEnts: function (a) { ents = a; },
    make: make, loadLesson: loadLesson, sunLight: sunLight, drawn: function () { return { lru: LRU.size, litOk: LIT_OK, planets: Object.keys(PTEX).length, sources: Object.keys(SRC).length }; }, toScreen: toScreen, toWorld: toWorld, zoomAt: zoomAt,
    doClick: doClick, doBox: doBox, clickWinner: clickWinner, boxWinners: boxWinners, live: live,
    TYPES: TYPES, LESSONS: LESSONS, CELL: CELL, SPLIT_IN: SPLIT_IN, SPLIT_OUT: SPLIT_OUT,
    view: function () { return { W: W, H: H, Y0: Y0, Y1: Y1 }; }
  };
  boot();
})();
