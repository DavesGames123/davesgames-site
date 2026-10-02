// ============================================================================
//  FLAG DESIGNER  ·  colony flag composer with a cloth view
// ----------------------------------------------------------------------------
//  A classic script. A flag is a pattern, a shape, an optional emblem and four
//  colours: c1, c2, c3 for the field and ce for the emblem. All drawing is new
//  2D canvas code on this page. The pattern and emblem NAMES come from
//  window.SN_DATA (lib/game-data/catalog.js). Glyph emblems draw the catalog
//  glyph as text and change it into a one-colour silhouette. Vector emblems
//  draw with the paths in VECTORS. Catalog emblems that have no drawing here
//  do not show.
//
//  RENDER PATH
//      state -> renderFlat(canvas, W, H, state)
//          pattern.draw(field, c1, c2, c3) -> emblem silhouette (ce)
//          -> clip to shape.path -> target canvas
//      renderFlat feeds the hero texture, every thumbnail and the PNG export.
//
//  CLOTH VIEW  (cloth.frame)
//      The texture is cut into vertical slices. Each slice is drawn with an
//      affine transform from a travelling wave, then shaded from the wave
//      slope. The loop stops when the hero is off screen, when the tab is
//      hidden, in the flat view, or on Pause.
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//      patterns ........... "var PATTERNS"
//      shapes ............. "var SHAPES"
//      vector emblems ..... "var VECTORS"
//      catalog read ....... "function readCatalog"
//      presets ............ "var PRESETS"
//      state .............. "var state"
//      colour maths ....... "function hexToRgb"
//      emblem masks ....... "function emblemMask"
//      flat render ........ "function renderFlat"
//      paint and sync ..... "function paint"
//      URL hash ........... "function readHash"
//      thumbnails ......... "function buildPatterns"
//      emblem picker ...... "function buildEmblems"
//      colour picker ...... "function buildPicker"
//      bottom sheet ....... "function buildSheet"
//      PNG export ......... "function exportPng"
//      cloth view ......... "var cloth"
//      screensaver hook ... "window.snSaver"
//      boot ............... "function boot"
// ============================================================================

(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  // ── PATTERNS ──
  // draw(x, W, H, c1, c2, c3) fills the full field. 'game' patterns use the
  // catalog slug and name. 'more' patterns are site extras with site names.
  function rect(x, c, a, b, w, h) { x.fillStyle = c; x.fillRect(a, b, w, h); }
  function poly(x, c, pts) {
    x.fillStyle = c; x.beginPath();
    pts.forEach(function (p, i) { if (i) x.lineTo(p[0], p[1]); else x.moveTo(p[0], p[1]); });
    x.closePath(); x.fill();
  }
  function bars(x, W, H, cols, vertical) {
    var n = cols.length;
    for (var i = 0; i < n; i++) {
      if (vertical) rect(x, cols[i], Math.floor(W * i / n), 0, Math.ceil(W / n) + 1, H);
      else rect(x, cols[i], 0, Math.floor(H * i / n), W, Math.ceil(H / n) + 1);
    }
  }
  var PATTERNS = {
    'plain': function (x, W, H, a) { rect(x, a, 0, 0, W, H); },
    'horizontal-halves': function (x, W, H, a, b) { bars(x, W, H, [a, b], false); },
    'vertical-halves': function (x, W, H, a, b) { bars(x, W, H, [a, b], true); },
    'horizontal-tricolour': function (x, W, H, a, b, c) { bars(x, W, H, [a, b, c], false); },
    'vertical-tricolour': function (x, W, H, a, b, c) { bars(x, W, H, [a, b, c], true); },
    'nordic-cross': function (x, W, H, a, b, c) {
      rect(x, a, 0, 0, W, H);
      var cx = W * 0.36, t = H * 0.24, t2 = H * 0.11;
      rect(x, b, cx - t / 2, 0, t, H); rect(x, b, 0, H / 2 - t / 2, W, t);
      rect(x, c, cx - t2 / 2, 0, t2, H); rect(x, c, 0, H / 2 - t2 / 2, W, t2);
    },
    'hoist-triangle': function (x, W, H, a, b) { rect(x, b, 0, 0, W, H); poly(x, a, [[0, 0], [W * 0.46, H / 2], [0, H]]); },
    'descending-diagonal': function (x, W, H, a, b) {
      rect(x, a, 0, 0, W, H);
      x.save(); x.strokeStyle = b; x.lineWidth = H * 0.26; x.beginPath(); x.moveTo(-W * 0.1, -H * 0.1); x.lineTo(W * 1.1, H * 1.1); x.stroke(); x.restore();
    },
    'quartered': function (x, W, H, a, b) {
      rect(x, a, 0, 0, W / 2, H / 2); rect(x, a, W / 2, H / 2, W / 2, H / 2);
      rect(x, b, W / 2, 0, W / 2, H / 2); rect(x, b, 0, H / 2, W / 2, H / 2);
    },
    'five-horizontal-bars': function (x, W, H, a, b) { bars(x, W, H, [a, b, a, b, a], false); },
    'five-vertical-bars': function (x, W, H, a, b) { bars(x, W, H, [a, b, a, b, a], true); },
    'saltire': function (x, W, H, a, b) {
      rect(x, a, 0, 0, W, H);
      x.save(); x.strokeStyle = b; x.lineWidth = H * 0.18; x.beginPath();
      x.moveTo(0, 0); x.lineTo(W, H); x.moveTo(W, 0); x.lineTo(0, H); x.stroke(); x.restore();
    },
    'canton': function (x, W, H, a, b) { rect(x, a, 0, 0, W, H); rect(x, b, 0, 0, W * 0.44, H * 0.54); },
    'fess': function (x, W, H, a, b) { rect(x, a, 0, 0, W, H); rect(x, b, 0, H / 3, W, H / 3); },
    'hoist-band': function (x, W, H, a, b) { rect(x, a, 0, 0, W, H); rect(x, b, 0, 0, W * 0.27, H); },
    'upper-left-triangle-over-a-secondary-field': function (x, W, H, a, b) { rect(x, b, 0, 0, W, H); poly(x, a, [[0, 0], [W, 0], [0, H]]); },

    // Site extras.
    'cross': function (x, W, H, a, b) { rect(x, a, 0, 0, W, H); var t = H * 0.2; rect(x, b, W / 2 - t / 2, 0, t, H); rect(x, b, 0, H / 2 - t / 2, W, t); },
    'per-bend': function (x, W, H, a, b) { rect(x, a, 0, 0, W, H); poly(x, b, [[0, 0], [W, 0], [W, H]]); },
    'pale': function (x, W, H, a, b) { rect(x, a, 0, 0, W, H); rect(x, b, W * 0.36, 0, W * 0.28, H); },
    'chief': function (x, W, H, a, b) { rect(x, a, 0, 0, W, H); rect(x, b, 0, 0, W, H * 0.33); },
    'base-stripe': function (x, W, H, a, b) { rect(x, a, 0, 0, W, H); rect(x, b, 0, H * 0.72, W, H * 0.28); },
    'border': function (x, W, H, a, b) { rect(x, b, 0, 0, W, H); var m = H * 0.13; rect(x, a, m, m, W - 2 * m, H - 2 * m); },
    'disc': function (x, W, H, a, b) { rect(x, a, 0, 0, W, H); x.fillStyle = b; x.beginPath(); x.arc(W / 2, H / 2, H * 0.3, 0, Math.PI * 2); x.fill(); },
    'ring': function (x, W, H, a, b) { rect(x, a, 0, 0, W, H); x.strokeStyle = b; x.lineWidth = H * 0.07; x.beginPath(); x.arc(W / 2, H / 2, H * 0.3, 0, Math.PI * 2); x.stroke(); },
    'lozenge': function (x, W, H, a, b) { rect(x, a, 0, 0, W, H); poly(x, b, [[W / 2, H * 0.08], [W * 0.92, H / 2], [W / 2, H * 0.92], [W * 0.08, H / 2]]); },
    'sunburst': function (x, W, H, a, b) {
      rect(x, a, 0, 0, W, H); x.fillStyle = b;
      var n = 18, R = W;
      for (var i = 0; i < n; i += 2) {
        var a1 = i / n * Math.PI * 2, a2 = (i + 1) / n * Math.PI * 2;
        x.beginPath(); x.moveTo(W / 2, H / 2); x.arc(W / 2, H / 2, R, a1, a2); x.closePath(); x.fill();
      }
    },
    'gyronny': function (x, W, H, a, b) {
      rect(x, a, 0, 0, W, H); x.fillStyle = b;
      for (var i = 0; i < 8; i += 2) {
        var a1 = i / 8 * Math.PI * 2, a2 = (i + 1) / 8 * Math.PI * 2;
        x.beginPath(); x.moveTo(W / 2, H / 2); x.arc(W / 2, H / 2, W, a1, a2); x.closePath(); x.fill();
      }
    },
    'pall': function (x, W, H, a, b) {
      rect(x, a, 0, 0, W, H);
      x.save(); x.strokeStyle = b; x.lineWidth = H * 0.16; x.lineJoin = 'miter'; x.beginPath();
      x.moveTo(-2, -2); x.lineTo(W * 0.42, H / 2); x.lineTo(-2, H + 2); x.moveTo(W * 0.42, H / 2); x.lineTo(W + 2, H / 2); x.stroke(); x.restore();
    },
    'chevron': function (x, W, H, a, b) { rect(x, a, 0, 0, W, H); poly(x, b, [[0, H * 0.62], [W / 2, H * 0.2], [W, H * 0.62], [W, H * 0.92], [W / 2, H * 0.5], [0, H * 0.92]]); },
    'checkers': function (x, W, H, a, b) { for (var r = 0; r < 4; r++) for (var c = 0; c < 6; c++) rect(x, (r + c) % 2 ? b : a, W * c / 6, H * r / 4, W / 6 + 1, H / 4 + 1); },
    'arrow': function (x, W, H, a, b) { rect(x, a, 0, 0, W, H); poly(x, b, [[0, 0], [W * 0.52, H / 2], [0, H], [W * 0.2, H / 2]]); },
    'serrated': function (x, W, H, a, b) {
      rect(x, b, 0, 0, W, H);
      var pts = [[0, 0]], n = 5;
      for (var i = 0; i < n; i++) { pts.push([W * 0.4, H * (i + 0.5) / n]); pts.push([W * 0.3, H * (i + 1) / n]); }
      pts.push([0, H]); poly(x, a, pts);
    },
    'stripes-thirteen': function (x, W, H, a, b) { var c = []; for (var i = 0; i < 9; i++) c.push(i % 2 ? b : a); bars(x, W, H, c, false); }
  };
  var GAME_PATTERN_ORDER = ['plain', 'horizontal-halves', 'vertical-halves', 'horizontal-tricolour', 'vertical-tricolour',
    'nordic-cross', 'hoist-triangle', 'descending-diagonal', 'quartered', 'five-horizontal-bars', 'five-vertical-bars',
    'saltire', 'canton', 'fess', 'hoist-band', 'upper-left-triangle-over-a-secondary-field'];
  var MORE_PATTERNS = [['cross', 'Cross'], ['per-bend', 'Per bend'], ['pale', 'Pale'], ['chief', 'Chief'],
    ['base-stripe', 'Base stripe'], ['border', 'Border'], ['disc', 'Disc'], ['ring', 'Ring'], ['lozenge', 'Lozenge'],
    ['sunburst', 'Sunburst'], ['gyronny', 'Gyronny'], ['pall', 'Pall'], ['chevron', 'Chevron'], ['checkers', 'Checkers'],
    ['arrow', 'Arrow'], ['serrated', 'Serrated'], ['stripes-thirteen', 'Nine stripes']];

  // ── SHAPES ──
  var SHAPES = [
    { id: 'standard', name: 'Standard', path: function (W, H) { return [[0, 0], [W, 0], [W, H], [0, H]]; } },
    { id: 'swallowtail', name: 'Swallowtail', path: function (W, H) { return [[0, 0], [W, 0], [W * 0.76, H / 2], [W, H], [0, H]]; } },
    { id: 'guidon', name: 'Guidon', path: function (W, H) { return [[0, 0], [W * 0.72, 0], [W, H / 2], [W * 0.72, H], [0, H]]; } },
    { id: 'pennant', name: 'Pennant', path: function (W, H) { return [[0, 0], [W, H / 2], [0, H]]; } },
    { id: 'burgee', name: 'Burgee', path: function (W, H) { return [[0, 0], [W, H * 0.2], [W * 0.6, H / 2], [W, H * 0.8], [0, H]]; } },
    { id: 'shield', name: 'Shield', path: function (W, H) { return [[0, 0], [W, 0], [W, H * 0.6], [W / 2, H], [0, H * 0.6]]; } }
  ];
  function shapeById(id) { for (var i = 0; i < SHAPES.length; i++) if (SHAPES[i].id === id) return SHAPES[i]; return SHAPES[0]; }

  // ── VECTOR EMBLEMS ──
  // Each draws white in a unit box from -1 to 1. Keys are catalog slugs.
  function star(x, n, r0, r1) {
    x.beginPath();
    for (var i = 0; i < n * 2; i++) {
      var a = i * Math.PI / n - Math.PI / 2, r = i % 2 ? r1 : r0;
      x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    x.closePath(); x.fill();
  }
  function disc(x, cx, cy, r) { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); }
  function cut(x, f) { x.save(); x.globalCompositeOperation = 'destination-out'; f(); x.restore(); }
  var VECTORS = {
    'star': function (x) { star(x, 5, 1, 0.42); },
    'moon': function (x) { disc(x, 0, 0, 0.92); cut(x, function () { disc(x, 0.4, -0.18, 0.78); }); },
    'heart-vector': function (x) {
      x.beginPath(); x.moveTo(0, 0.9);
      x.bezierCurveTo(-0.4, 0.55, -1, 0.15, -0.96, -0.32);
      x.bezierCurveTo(-0.92, -0.9, -0.2, -1, 0, -0.5);
      x.bezierCurveTo(0.2, -1, 0.92, -0.9, 0.96, -0.32);
      x.bezierCurveTo(1, 0.15, 0.4, 0.55, 0, 0.9); x.fill();
    },
    'chevron': function (x) {
      x.beginPath(); x.moveTo(-0.95, 0.1); x.lineTo(0, -0.75); x.lineTo(0.95, 0.1); x.lineTo(0.95, 0.55); x.lineTo(0, -0.3); x.lineTo(-0.95, 0.55); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(-0.95, 0.6); x.lineTo(0, -0.18); x.lineTo(0.95, 0.6); x.lineTo(0.95, 0.95); x.lineTo(0, 0.2); x.lineTo(-0.95, 0.95); x.closePath(); x.fill();
    },
    'shield': function (x) {
      x.beginPath(); x.moveTo(-0.8, -0.9); x.lineTo(0.8, -0.9); x.lineTo(0.8, 0);
      x.quadraticCurveTo(0.75, 0.65, 0, 0.98); x.quadraticCurveTo(-0.75, 0.65, -0.8, 0); x.closePath(); x.fill();
      cut(x, function () { x.fillRect(-0.08, -0.75, 0.16, 1.45); x.fillRect(-0.62, -0.32, 1.24, 0.16); });
    },
    'sparkle': function (x) {
      x.beginPath(); x.moveTo(0, -1);
      x.quadraticCurveTo(0.12, -0.12, 1, 0); x.quadraticCurveTo(0.12, 0.12, 0, 1);
      x.quadraticCurveTo(-0.12, 0.12, -1, 0); x.quadraticCurveTo(-0.12, -0.12, 0, -1); x.fill();
    },
    'ringed-planet': function (x) {
      x.save(); x.rotate(-0.38);
      x.lineWidth = 0.13; x.strokeStyle = '#fff';
      x.beginPath(); x.ellipse(0, 0, 0.98, 0.3, 0, 0, Math.PI * 2); x.stroke();
      cut(x, function () { x.beginPath(); x.ellipse(0, 0, 0.62, 0.62, 0, Math.PI, Math.PI * 2); x.fill(); });
      x.restore();
      disc(x, 0, 0, 0.5);
      cut(x, function () { x.save(); x.rotate(-0.38); x.lineWidth = 0.1; x.beginPath(); x.ellipse(0, 0, 0.98, 0.42, 0, 0.15, Math.PI - 0.15); x.stroke(); x.restore(); });
      x.save(); x.rotate(-0.38); x.lineWidth = 0.13; x.strokeStyle = '#fff'; x.beginPath(); x.ellipse(0, 0, 0.98, 0.3, 0, 0.2, Math.PI - 0.2); x.stroke(); x.restore();
    },
    'sun-vector': function (x) {
      disc(x, 0, 0, 0.46);
      for (var i = 0; i < 12; i++) {
        var a = i / 12 * Math.PI * 2, s = 0.13;
        x.beginPath(); x.moveTo(Math.cos(a - s) * 0.58, Math.sin(a - s) * 0.58);
        x.lineTo(Math.cos(a) * 0.98, Math.sin(a) * 0.98); x.lineTo(Math.cos(a + s) * 0.58, Math.sin(a + s) * 0.58); x.closePath(); x.fill();
      }
    },
    'comet': function (x) {
      disc(x, 0.48, -0.48, 0.34);
      x.beginPath(); x.moveTo(0.26, -0.74); x.lineTo(-0.95, 0.75); x.lineTo(0.74, -0.26); x.closePath(); x.fill();
      x.lineWidth = 0.08; x.strokeStyle = '#fff'; x.lineCap = 'round';
      x.beginPath(); x.moveTo(0.1, -0.2); x.lineTo(-0.55, 0.95); x.moveTo(0.2, -0.1); x.lineTo(-0.95, 0.55); x.stroke();
    },
    'crown': function (x) {
      x.beginPath(); x.moveTo(-0.9, 0.55); x.lineTo(-0.95, -0.45); x.lineTo(-0.45, 0.05); x.lineTo(0, -0.7);
      x.lineTo(0.45, 0.05); x.lineTo(0.95, -0.45); x.lineTo(0.9, 0.55); x.closePath(); x.fill();
      x.fillRect(-0.9, 0.65, 1.8, 0.22);
      disc(x, -0.95, -0.55, 0.12); disc(x, 0, -0.82, 0.13); disc(x, 0.95, -0.55, 0.12);
    },
    'flame': function (x) {
      x.beginPath(); x.moveTo(0, -1);
      x.bezierCurveTo(0.2, -0.5, 0.8, -0.2, 0.7, 0.35); x.bezierCurveTo(0.62, 0.8, 0.3, 0.98, 0, 0.98);
      x.bezierCurveTo(-0.3, 0.98, -0.66, 0.8, -0.7, 0.35); x.bezierCurveTo(-0.72, 0, -0.45, -0.25, -0.3, -0.5);
      x.bezierCurveTo(-0.25, -0.2, -0.1, -0.1, -0.05, -0.12); x.bezierCurveTo(0.05, -0.45, -0.1, -0.7, 0, -1); x.fill();
      cut(x, function () {
        x.beginPath(); x.moveTo(0, -0.1); x.bezierCurveTo(0.2, 0.15, 0.36, 0.4, 0.3, 0.6);
        x.bezierCurveTo(0.24, 0.8, -0.24, 0.8, -0.3, 0.6); x.bezierCurveTo(-0.34, 0.4, -0.1, 0.25, 0, -0.1); x.fill();
      });
    },
    'leaf': function (x) {
      x.save(); x.rotate(Math.PI / 4);
      x.beginPath(); x.moveTo(0, -1); x.quadraticCurveTo(0.75, 0, 0, 1); x.quadraticCurveTo(-0.75, 0, 0, -1); x.fill();
      cut(x, function () { x.lineWidth = 0.07; x.beginPath(); x.moveTo(0, -0.75); x.lineTo(0, 0.85); x.stroke(); });
      x.restore();
    },
    'gear-vector': function (x) {
      x.beginPath();
      var n = 9;
      for (var i = 0; i < n; i++) {
        var a = i / n * Math.PI * 2, w = Math.PI / n * 0.5;
        x.lineTo(Math.cos(a - w * 1.25) * 0.72, Math.sin(a - w * 1.25) * 0.72);
        x.lineTo(Math.cos(a - w * 0.8) * 0.98, Math.sin(a - w * 0.8) * 0.98);
        x.lineTo(Math.cos(a + w * 0.8) * 0.98, Math.sin(a + w * 0.8) * 0.98);
        x.lineTo(Math.cos(a + w * 1.25) * 0.72, Math.sin(a + w * 1.25) * 0.72);
      }
      x.closePath(); x.fill();
      cut(x, function () { disc(x, 0, 0, 0.32); });
    }
  };
  var VECTOR_FALLBACK_NAMES = { 'star': 'Star', 'moon': 'Moon', 'heart-vector': 'Heart', 'chevron': 'Chevron', 'shield': 'Shield',
    'sparkle': 'Sparkle', 'ringed-planet': 'Ringed Planet', 'sun-vector': 'Sun', 'comet': 'Comet', 'crown': 'Crown',
    'flame': 'Flame', 'leaf': 'Leaf', 'gear-vector': 'Gear' };
  var GLYPH_FONT = '"Apple Symbols","Segoe UI Symbol","Noto Sans Symbols 2","Noto Sans Symbols","DejaVu Sans",sans-serif';

  // ── CATALOG READ ──
  // patterns: [{id, name, game}] ; emblems: [{id, name, group, glyph|null}]
  var catalog = { patterns: [], emblems: [] };
  function readCatalog() {
    var data = window.SN_DATA, names = {}, emb = [];
    if (data && data.entries) {
      data.entries.forEach(function (e) {
        if (e.category === 'flag-patterns') names[e.slug] = e.name;
        if (e.category === 'flag-emblems') {
          if (e.group === 'Glyph' && e.fields && e.fields.Glyph) emb.push({ id: e.slug, name: e.name, group: 'Glyph', glyph: e.fields.Glyph });
          else if (VECTORS[e.slug]) emb.push({ id: e.slug, name: e.name, group: e.group || 'Vector', glyph: null });
        }
      });
    }
    if (!emb.length) Object.keys(VECTORS).forEach(function (k) { emb.push({ id: k, name: VECTOR_FALLBACK_NAMES[k], group: 'Vector', glyph: null }); });
    GAME_PATTERN_ORDER.forEach(function (slug) {
      catalog.patterns.push({ id: slug, name: names[slug] || slug.replace(/-/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }), game: true });
    });
    MORE_PATTERNS.forEach(function (p) { catalog.patterns.push({ id: p[0], name: p[1], game: false }); });
    catalog.emblems = emb;
  }
  function patternById(id) { for (var i = 0; i < catalog.patterns.length; i++) if (catalog.patterns[i].id === id) return catalog.patterns[i]; return null; }
  function emblemById(id) { for (var i = 0; i < catalog.emblems.length; i++) if (catalog.emblems[i].id === id) return catalog.emblems[i]; return null; }

  // ── PRESETS ──
  // Site banners: [name, c1, c2, c3, ce, pattern, shape, emblem].
  var PRESETS = [
    ['Viper', '#6b1d1d', '#c0c8d0', '#c0c8d0', '#e8d060', 'cross', 'standard', 'star'],
    ['Terran', '#c0c8d0', '#18244a', '#18244a', '#e8ecf4', 'canton', 'standard', 'star'],
    ['Martian', '#8b0000', '#d2691e', '#ffd700', '#ffd700', 'chevron', 'standard', 'none'],
    ['Void Corp', '#0a0a14', '#8866ff', '#8866ff', '#00e8ff', 'saltire', 'standard', 'open-circle'],
    ['Solaris', '#cc4400', '#ff9900', '#ff9900', '#ffffff', 'sunburst', 'standard', 'sun-vector'],
    ['Frostheim', '#2080c0', '#d0e8f0', '#ffffff', '#ffffff', 'nordic-cross', 'swallowtail', 'none'],
    ['Jade Fed', '#005544', '#50c878', '#50c878', '#ffd700', 'per-bend', 'standard', 'filled-diamond'],
    ['Crimson', '#8a1a1a', '#e8e0d0', '#e8e0d0', '#ffffff', 'cross', 'shield', 'none'],
    ['Nebula', '#3020a0', '#00e8ff', '#00e8ff', '#ff40ff', 'upper-left-triangle-over-a-secondary-field', 'guidon', 'sparkle'],
    ['Iron', '#404850', '#c0c0c0', '#c0c0c0', '#e0a030', 'fess', 'standard', 'gear-vector'],
    ['Nova', '#1a0033', '#ff40ff', '#ff40ff', '#ffffff', 'gyronny', 'standard', 'eight-pointed-star'],
    ['Auroran', '#004466', '#66ffcc', '#66ffcc', '#ffd700', 'pall', 'pennant', 'none'],
    ['Scorched', '#330000', '#ff3300', '#ff3300', '#ff9900', 'arrow', 'guidon', 'flame'],
    ['Polar', '#e0e8f0', '#1a2a4a', '#1a2a4a', '#e0e8f0', 'canton', 'standard', 'filled-star'],
    ['Amber', '#8b4513', '#daa520', '#8b4513', '#8b4513', 'vertical-tricolour', 'standard', 'filled-circle'],
    ['Emerald', '#003300', '#00cc66', '#00cc66', '#ffd700', 'five-horizontal-bars', 'standard', 'moon'],
    ['Titanium', '#1a1a2e', '#e94560', '#e94560', '#ffffff', 'descending-diagonal', 'swallowtail', 'none'],
    ['Monarch', '#4a0060', '#ffd700', '#ffd700', '#ffd700', 'border', 'shield', 'crown'],
    ['Tempest', '#003355', '#88ccee', '#88ccee', '#ffd700', 'five-vertical-bars', 'standard', 'lightning'],
    ['Sentinel', '#222222', '#888890', '#888890', '#ffcc00', 'chief', 'standard', 'anchor'],
    ['Harbour', '#f2f4f8', '#1f3f8f', '#d23a3a', '#1f3f8f', 'horizontal-tricolour', 'burgee', 'none'],
    ['Outpost', '#2a2f3a', '#ffc832', '#2a2f3a', '#ffc832', 'hoist-band', 'standard', 'ringed-planet']
  ];

  var QUICK = ['#f2f4f8', '#9aa3b2', '#2a2f3a', '#0c0e14', '#d23a3a', '#ff8a2a', '#ffc832', '#7bd13b',
               '#1fa37a', '#2bc4e0', '#2f6fe0', '#6a4ae0', '#c04ad8', '#ff5aa5', '#8b5a2b', '#c9b48a'];

  // ── STATE ──
  var state = { c1: '#6b1d1d', c2: '#c0c8d0', c3: '#c0c8d0', ce: '#e8d060', pattern: 'cross', shape: 'standard',
                emblem: 'star', size: 50, pos: 'center', channel: 'c1' };

  // ── COLOUR MATHS ──
  function hexToRgb(h) { var n = parseInt(String(h).replace('#', ''), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
  function rgbToHex(r, g, b) { return '#' + ((1 << 24) + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b)).toString(16).slice(1); }
  function normHex(v) {
    v = String(v || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(v)) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
    return /^[0-9a-f]{6}$/i.test(v) ? '#' + v.toLowerCase() : null;
  }
  function toHsv(hex) {
    var c = hexToRgb(hex), r = c.r / 255, g = c.g / 255, b = c.b / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return { h: h, s: mx ? d / mx : 0, v: mx };
  }
  function fromHsv(h, s, v) {
    var f = function (n) { var k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return rgbToHex(f(5) * 255, f(3) * 255, f(1) * 255);
  }

  // ── EMBLEM MASKS ──
  // A white silhouette of one emblem in a px x px canvas, cached by id and size.
  function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; }
  var maskCache = {}, maskKeys = [];
  function emblemMask(em, px) {
    px = Math.max(8, Math.round(px));
    var key = em.id + '|' + px;
    if (maskCache[key]) return maskCache[key];
    var c = makeCanvas(px), x = c.getContext('2d');
    if (em.glyph) {
      var g = em.glyph + '︎';
      x.font = px + 'px ' + GLYPH_FONT;
      var m = x.measureText(g);
      var bw = (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || px * 0.8);
      var bh = (m.actualBoundingBoxAscent || px * 0.8) + (m.actualBoundingBoxDescent || 0);
      var k = Math.min(px * 0.94 / Math.max(1, bw), px * 0.94 / Math.max(1, bh));
      var fs = px * k;
      x.font = fs + 'px ' + GLYPH_FONT;
      m = x.measureText(g);
      var L = m.actualBoundingBoxLeft || 0, R = m.actualBoundingBoxRight || fs * 0.8;
      var A = m.actualBoundingBoxAscent || fs * 0.8, D = m.actualBoundingBoxDescent || 0;
      x.fillStyle = '#fff';
      x.fillText(g, px / 2 + (L - R) / 2, px / 2 + (A - D) / 2);
      // A colour emoji can replace the glyph; this pass keeps only its outline.
      x.globalCompositeOperation = 'source-in';
      x.fillRect(0, 0, px, px);
    } else if (VECTORS[em.id]) {
      x.translate(px / 2, px / 2); x.scale(px / 2 * 0.96, px / 2 * 0.96);
      x.fillStyle = '#fff'; x.strokeStyle = '#fff';
      VECTORS[em.id](x);
    }
    maskCache[key] = c; maskKeys.push(key);
    if (maskKeys.length > 160) delete maskCache[maskKeys.shift()];
    return c;
  }
  function drawEmblem(x, em, cx, cy, box, colour) {
    var px = Math.round(box);
    var m = emblemMask(em, px);
    var t = makeCanvas(px), tx = t.getContext('2d');
    tx.drawImage(m, 0, 0);
    tx.globalCompositeOperation = 'source-in';
    tx.fillStyle = colour; tx.fillRect(0, 0, px, px);
    x.drawImage(t, cx - px / 2, cy - px / 2);
  }

  // ── FLAT RENDER ──
  // Draw a flag set into canvas at W x H. Outside the shape stays transparent.
  function renderFlat(canvas, W, H, st, outline) {
    canvas.width = W; canvas.height = H;
    var x = canvas.getContext('2d');
    var field = makeCanvas(W, H), f = field.getContext('2d');
    (PATTERNS[st.pattern] || PATTERNS.plain)(f, W, H, st.c1, st.c2, st.c3);
    var em = st.emblem !== 'none' ? emblemById(st.emblem) : null;
    if (em) {
      var box = H * st.size / 100, cx = W / 2, cy = H / 2;
      if (st.pos === 'hoist') { cx = Math.max(box / 2 + H * 0.08, W * 0.25); }
      if (st.pos === 'canton') { box = Math.min(box * 0.7, H * 0.44); cx = W * 0.22; cy = H * 0.27; }
      if (st.shape === 'pennant' || st.shape === 'burgee') { if (st.pos === 'center') cx = W * 0.3; }
      drawEmblem(f, em, cx, cy, box, st.ce);
    }
    var pts = shapeById(st.shape).path(W, H);
    x.save(); x.beginPath();
    pts.forEach(function (p, i) { if (i) x.lineTo(p[0], p[1]); else x.moveTo(p[0], p[1]); });
    x.closePath(); x.clip(); x.drawImage(field, 0, 0); x.restore();
    if (outline) {
      x.beginPath(); pts.forEach(function (p, i) { if (i) x.lineTo(p[0], p[1]); else x.moveTo(p[0], p[1]); });
      x.closePath(); x.strokeStyle = 'rgba(200,220,255,0.22)'; x.lineWidth = 1; x.stroke();
    }
    return canvas;
  }

  // ── PAINT AND SYNC ──
  var paintQueued = false;
  function schedulePaint() {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(function () { paintQueued = false; paint(); });
  }
  function paint() {
    cloth.setTexture();
    renderPatternThumbs();
    syncUi();
    if (!saverOn) writeHash();
  }
  function presetMatch() {
    for (var i = 0; i < PRESETS.length; i++) {
      var p = PRESETS[i];
      if (p[1] === state.c1 && p[2] === state.c2 && p[3] === state.c3 && p[4] === state.ce && p[5] === state.pattern && p[6] === state.shape && p[7] === state.emblem) return p[0];
    }
    return null;
  }
  function syncUi() {
    var name = presetMatch();
    $('flagName').textContent = name || 'Custom';
    var pat = patternById(state.pattern), em = emblemById(state.emblem);
    $('flagSub').textContent = [pat ? pat.name : state.pattern, em ? em.name : 'No emblem', shapeById(state.shape).name].join(' · ');
    document.querySelectorAll('#presetGrid .thumb').forEach(function (el) { el.classList.toggle('on', el.dataset.name === name); });
    document.querySelectorAll('[data-pattern]').forEach(function (el) { el.classList.toggle('on', el.dataset.pattern === state.pattern); });
    document.querySelectorAll('#emblemGrid button').forEach(function (el) { el.classList.toggle('on', el.dataset.emblem === state.emblem); });
    document.querySelectorAll('#shapeGrid button').forEach(function (el) { el.classList.toggle('on', el.dataset.shape === state.shape); });
    document.querySelectorAll('#emblemPos button').forEach(function (el) { el.classList.toggle('on', el.dataset.pos === state.pos); });
    document.querySelectorAll('#channels button').forEach(function (b) {
      b.querySelector('i').style.background = state[b.dataset.ch];
      b.classList.toggle('on', b.dataset.ch === state.channel);
      b.setAttribute('aria-checked', b.dataset.ch === state.channel ? 'true' : 'false');
    });
    $('emblemSize').value = state.size; $('emblemSizeVal').textContent = state.size + '%';
    picker.show(state[state.channel]);
  }
  function setState(patch) { for (var k in patch) state[k] = patch[k]; schedulePaint(); }

  // ── URL HASH ──
  // Format: #p=<pattern>&s=<shape>&e=<emblem>&c=c1,c2,c3,ce&z=<size>&at=<place>
  function readHash() {
    var h = (location.hash || '').replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('='), k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1));
      if (k === 'p' && PATTERNS[v]) state.pattern = v;
      if (k === 's' && SHAPES.some(function (s) { return s.id === v; })) state.shape = v;
      if (k === 'e' && (v === 'none' || emblemById(v))) state.emblem = v;
      if (k === 'z' && +v >= 20 && +v <= 80) state.size = Math.round(+v);
      if (k === 'at' && /^(center|hoist|canton)$/.test(v)) state.pos = v;
      if (k === 'c') v.split(',').forEach(function (c, j) { var n = normHex(c); if (n) state[['c1', 'c2', 'c3', 'ce'][j]] = n; });
    });
  }
  function hashString() {
    return 'p=' + state.pattern + '&s=' + state.shape + '&e=' + state.emblem +
      '&c=' + [state.c1, state.c2, state.c3, state.ce].map(function (c) { return c.slice(1); }).join(',') +
      '&z=' + state.size + '&at=' + state.pos;
  }
  var hashTimer = 0;
  var saverOn = false;   // screensaver mode: no hash writes, no name band
  function writeHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(function () { try { history.replaceState(null, '', '#' + hashString()); } catch (e) { /* ignore */ } }, 250);
  }

  var toastTimer = 0;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  // ── THUMBNAILS ──
  function thumbButton(label) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'thumb';
    var c = makeCanvas(150, 100), s = document.createElement('span');
    s.textContent = label; b.appendChild(c); b.appendChild(s);
    return b;
  }
  function buildPresets() {
    var grid = $('presetGrid');
    PRESETS.forEach(function (p) {
      var b = thumbButton(p[0]); b.dataset.name = p[0];
      renderFlat(b.querySelector('canvas'), 150, 100, { c1: p[1], c2: p[2], c3: p[3], ce: p[4], pattern: p[5], shape: p[6], emblem: p[7], size: 50, pos: 'center' }, true);
      b.addEventListener('click', function () {
        setState({ c1: p[1], c2: p[2], c3: p[3], ce: p[4], pattern: p[5], shape: p[6], emblem: p[7], size: 50, pos: 'center' });
      });
      grid.appendChild(b);
    });
  }
  function buildPatterns() {
    catalog.patterns.forEach(function (p) {
      var b = thumbButton(p.name); b.dataset.pattern = p.id;
      b.addEventListener('click', function () { setState({ pattern: p.id }); });
      (p.game ? $('patternGrid') : $('patternGridMore')).appendChild(b);
    });
  }
  // Pattern thumbnails use the live colours and shape, without the emblem.
  function renderPatternThumbs() {
    document.querySelectorAll('[data-pattern]').forEach(function (b) {
      var st = { c1: state.c1, c2: state.c2, c3: state.c3, ce: state.ce, pattern: b.dataset.pattern, shape: state.shape, emblem: 'none', size: 50, pos: 'center' };
      renderFlat(b.querySelector('canvas'), 150, 100, st, true);
    });
  }
  function buildShapes() {
    var grid = $('shapeGrid');
    SHAPES.forEach(function (s) {
      var b = document.createElement('button'); b.type = 'button'; b.dataset.shape = s.id;
      var d = s.path(72, 48).map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ') + 'Z';
      b.innerHTML = '<svg viewBox="-2 -2 76 52" aria-hidden="true"><path d="' + d + '" fill="rgba(150,200,255,.18)" stroke="rgba(150,200,255,.6)" stroke-width="1.2"/></svg><span></span>';
      b.querySelector('span').textContent = s.name;
      b.addEventListener('click', function () { setState({ shape: s.id }); });
      grid.appendChild(b);
    });
  }

  // ── EMBLEM PICKER ──
  // A search field and a group filter over the drawable catalog emblems.
  function buildEmblems() {
    var grid = $('emblemGrid'), groups = ['All'], filter = 'All';
    catalog.emblems.forEach(function (e) { if (groups.indexOf(e.group) < 0) groups.push(e.group); });
    var segEl = $('emblemGroups');
    groups.forEach(function (g) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = g; b.dataset.group = g;
      if (g === filter) b.className = 'on';
      b.addEventListener('click', function () {
        filter = g;
        segEl.querySelectorAll('button').forEach(function (o) { o.classList.toggle('on', o === b); });
        apply();
      });
      segEl.appendChild(b);
    });
    var none = document.createElement('button'); none.type = 'button'; none.dataset.emblem = 'none';
    none.innerHTML = '<span class="none">None</span>'; none.title = 'No emblem';
    none.addEventListener('click', function () { setState({ emblem: 'none' }); });
    grid.appendChild(none);
    catalog.emblems.forEach(function (e) {
      var b = document.createElement('button'); b.type = 'button'; b.dataset.emblem = e.id; b.dataset.group = e.group;
      b.title = e.name; b.setAttribute('aria-label', e.name);
      var c = makeCanvas(64), x = c.getContext('2d');
      drawEmblem(x, e, 32, 32, 60, '#cfe2ff');
      b.appendChild(c);
      b.addEventListener('click', function () { setState({ emblem: e.id }); });
      grid.appendChild(b);
    });
    var empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'No emblem has that name.'; empty.hidden = true;
    grid.parentNode.insertBefore(empty, grid.nextSibling);
    function apply() {
      var q = $('emblemSearch').value.trim().toLowerCase(), shown = 0;
      grid.querySelectorAll('button').forEach(function (b) {
        if (b.dataset.emblem === 'none') { b.hidden = !!q; return; }
        var ok = (filter === 'All' || b.dataset.group === filter) && (!q || b.title.toLowerCase().indexOf(q) >= 0);
        b.hidden = !ok; if (ok) shown++;
      });
      empty.hidden = shown > 0;
    }
    $('emblemSearch').addEventListener('input', apply);
    $('emblemSize').addEventListener('input', function () { setState({ size: +this.value }); });
    document.querySelectorAll('#emblemPos button').forEach(function (b) {
      b.addEventListener('click', function () { setState({ pos: b.dataset.pos }); });
    });
  }

  // ── COLOUR PICKER ──
  // One SV square and one hue bar edit the selected channel, with pointer capture.
  var picker = { show: function () {} };
  function buildPicker() {
    var sv = $('sv'), hue = $('hue'), hexIn = $('hexInput');
    var svKnob = sv.querySelector('.knob'), hueKnob = hue.querySelector('.knob');
    var hsv = toHsv(state[state.channel]);
    function render(hex) {
      sv.style.setProperty('--hue', Math.round(hsv.h));
      svKnob.style.left = (hsv.s * 100) + '%'; svKnob.style.top = ((1 - hsv.v) * 100) + '%'; svKnob.style.background = hex;
      hueKnob.style.left = (hsv.h / 360 * 100) + '%'; hueKnob.style.background = 'hsl(' + Math.round(hsv.h) + ',100%,50%)';
      $('curSwatch').style.background = hex;
      if (document.activeElement !== hexIn) hexIn.value = hex.toUpperCase();
    }
    picker.show = function (hex) {
      var next = toHsv(hex);
      if (next.s < 0.005 || next.v < 0.005) next.h = hsv.h;
      if (next.v < 0.005) next.s = hsv.s;
      if (fromHsv(hsv.h, hsv.s, hsv.v) !== hex) hsv = next;
      render(hex);
    };
    function commit() { var p = {}; p[state.channel] = fromHsv(hsv.h, hsv.s, hsv.v); setState(p); }
    function drag(el, onMove) {
      el.addEventListener('pointerdown', function (e) {
        e.preventDefault(); el.setPointerCapture(e.pointerId); onMove(e);
        function up() { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); }
        el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      });
    }
    drag(sv, function (e) {
      var r = sv.getBoundingClientRect();
      hsv.s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      hsv.v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
      commit();
    });
    drag(hue, function (e) {
      var r = hue.getBoundingClientRect();
      hsv.h = Math.max(0, Math.min(359.9, (e.clientX - r.left) / r.width * 360));
      commit();
    });
    hexIn.addEventListener('change', function () {
      var c = normHex(hexIn.value), p = {};
      if (c) { hsv = toHsv(c); p[state.channel] = c; setState(p); } else hexIn.value = state[state.channel].toUpperCase();
    });
    hexIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') hexIn.blur(); });
    QUICK.forEach(function (c) {
      var b = document.createElement('button'); b.type = 'button'; b.style.background = c; b.setAttribute('aria-label', 'Colour ' + c);
      b.addEventListener('click', function () { var p = {}; hsv = toHsv(c); p[state.channel] = c; setState(p); });
      $('quick').appendChild(b);
    });
    document.querySelectorAll('#channels button').forEach(function (b) {
      b.setAttribute('role', 'radio');
      b.addEventListener('click', function () { state.channel = b.dataset.ch; hsv = toHsv(state[state.channel]); syncUi(); });
    });
    $('btnSwap').addEventListener('click', function () { var a = state.c1; state.c1 = state.c2; state.c2 = a; hsv = toHsv(state[state.channel]); schedulePaint(); });
    $('btnRandom').addEventListener('click', function () {
      var h = Math.random() * 360;
      var all = catalog.patterns, ems = catalog.emblems;
      setState({
        c1: fromHsv(h, 0.5 + Math.random() * 0.5, 0.25 + Math.random() * 0.5),
        c2: fromHsv((h + 150 + Math.random() * 60) % 360, Math.random() * 0.6, 0.75 + Math.random() * 0.25),
        c3: fromHsv((h + 40) % 360, 0.6 + Math.random() * 0.4, 0.5 + Math.random() * 0.5),
        ce: Math.random() < 0.5 ? '#f2f4f8' : fromHsv((h + 60) % 360, 0.7, 1),
        pattern: all[Math.floor(Math.random() * all.length)].id,
        emblem: Math.random() < 0.3 ? 'none' : ems[Math.floor(Math.random() * ems.length)].id
      });
      hsv = toHsv(state[state.channel]);
    });
  }

  // ── TABS AND BOTTOM SHEET ──
  function buildSheet() {
    var panel = $('panel'), grip = $('grip');
    var phone = window.matchMedia('(max-width: 900px)');
    function setTab(id) {
      document.querySelectorAll('.tabs button').forEach(function (b) {
        b.classList.toggle('on', b.dataset.tab === id); b.setAttribute('aria-selected', b.dataset.tab === id ? 'true' : 'false');
      });
      document.querySelectorAll('.tab-body').forEach(function (el) { el.hidden = el.dataset.body !== id; });
    }
    // On a phone, scroll so that the hero flag sits in the free space above the sheet.
    function open() {
      panel.classList.add('sheet-open');
      // A landscape phone shows the panel as a side column (style.css), not
      // as a sheet. Then the hero is already in view and no scroll is necessary.
      if (getComputedStyle(panel).position !== 'fixed') return;
      var r = $('heroWrap').getBoundingClientRect();
      var free = window.innerHeight - panel.getBoundingClientRect().height;
      var dy = r.top + r.height / 2 - free / 2;
      if (Math.abs(dy) > 8) window.scrollBy({ top: dy, behavior: 'smooth' });
    }
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.addEventListener('click', function () { setTab(b.dataset.tab); if (phone.matches && !panel.classList.contains('sheet-open')) open(); });
    });
    function toggle() { if (panel.classList.contains('sheet-open')) panel.classList.remove('sheet-open'); else open(); }
    grip.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    var startY = 0, startOpen = false, moved = false, h = 0;
    grip.addEventListener('pointerdown', function (e) {
      if (!phone.matches) return;
      grip.setPointerCapture(e.pointerId);
      startY = e.clientY; startOpen = panel.classList.contains('sheet-open'); moved = false;
      h = panel.getBoundingClientRect().height; panel.classList.add('dragging');
    });
    grip.addEventListener('pointermove', function (e) {
      if (!panel.classList.contains('dragging')) return;
      var dy = e.clientY - startY; if (Math.abs(dy) > 4) moved = true;
      var closed = h - 108;
      panel.style.transform = 'translateY(' + Math.max(0, Math.min(closed, (startOpen ? 0 : closed) + dy)) + 'px)';
    });
    function end(e) {
      if (!panel.classList.contains('dragging')) return;
      panel.classList.remove('dragging'); panel.style.transform = '';
      var dy = e.clientY - startY;
      if (!moved) toggle();
      else if (startOpen && dy > 60) panel.classList.remove('sheet-open');
      else if (!startOpen && dy < -60) open();
    }
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  }

  // ── PNG EXPORT AND LINK ──
  function exportPng() {
    var c = renderFlat(makeCanvas(1200, 800), 1200, 800, state, false);
    var name = 'stella-nova-flag-' + (presetMatch() || 'custom').toLowerCase().replace(/\s+/g, '-') + '.png';
    try {
      c.toBlob(function (blob) {
        if (!blob) { toast('Export failed in this browser'); return; }
        var url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        toast('Saved ' + name);
      }, 'image/png');
    } catch (err) { toast('Export failed: ' + err.message); }
  }
  function copyLink() {
    var url = location.href.split('#')[0] + '#' + hashString();
    function fallback() {
      var t = document.createElement('textarea'); t.value = url; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      t.remove(); toast(ok ? 'Link copied' : 'Copy failed: ' + url);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { toast('Link copied'); }, fallback);
    else fallback();
  }

  // ── CLOTH VIEW ──
  // The flag hangs from a pole at the hoist. A travelling wave moves along the
  // fly; its amplitude grows from zero at the pole. Each of N slices of the
  // texture is drawn with one affine transform, then shaded by the wave slope
  // on a separate layer, so that the shade touches only the cloth.
  var cloth = {
    canvas: null, ctx: null, layer: null, lctx: null, bg: null, tex: null,
    w: 0, h: 0, dpr: 1, t: 0, last: 0, wind: 0.55, view: 'wave',
    paused: false, visible: true, onScreen: true, running: false,
    TW: 600, TH: 400, N: 96,
    tScale: 1   // wave time scale; the screensaver slows it
  };
  cloth.setTexture = function () {
    cloth.tex = renderFlat(cloth.tex || makeCanvas(cloth.TW, cloth.TH), cloth.TW, cloth.TH, state, false);
    if (!cloth.running) clothDraw();
  };
  function clothInit() {
    cloth.canvas = $('flagCanvas'); cloth.ctx = cloth.canvas.getContext('2d');
    cloth.layer = makeCanvas(2); cloth.lctx = cloth.layer.getContext('2d');
    clothResize();
    if (window.ResizeObserver) new ResizeObserver(function () { clothResize(); clothKick(); }).observe($('heroWrap'));
    else window.addEventListener('resize', function () { clothResize(); clothKick(); });
    if (window.IntersectionObserver) new IntersectionObserver(function (es) { cloth.onScreen = es[0].isIntersecting; clothKick(); }, { threshold: 0.01 }).observe($('heroWrap'));
    document.addEventListener('visibilitychange', function () { cloth.visible = !document.hidden; clothKick(); });
    $('wind').addEventListener('input', function () { cloth.wind = +this.value; if (!cloth.running) clothDraw(); });
    $('btnPause').addEventListener('click', function () {
      cloth.paused = !cloth.paused;
      this.setAttribute('aria-pressed', cloth.paused ? 'true' : 'false');
      this.textContent = cloth.paused ? 'Play' : 'Pause';
      clothKick();
    });
    document.querySelectorAll('#viewSeg button').forEach(function (b) {
      b.addEventListener('click', function () {
        cloth.view = b.dataset.view;
        document.querySelectorAll('#viewSeg button').forEach(function (o) { o.classList.toggle('on', o === b); });
        $('wind').disabled = cloth.view === 'flat'; $('btnPause').disabled = cloth.view === 'flat';
        clothKick(); clothDraw();
      });
    });
  }
  function clothResize() {
    var r = $('heroWrap').getBoundingClientRect();
    cloth.dpr = Math.min(window.devicePixelRatio || 1, 2);
    cloth.w = Math.max(1, r.width); cloth.h = Math.max(1, r.height);
    var W = Math.round(cloth.w * cloth.dpr), H = Math.round(cloth.h * cloth.dpr);
    cloth.canvas.width = W; cloth.canvas.height = H; cloth.layer.width = W; cloth.layer.height = H;
    var bg = makeCanvas(W, H), x = bg.getContext('2d');
    var g = x.createRadialGradient(W * 0.55, H * 0.4, 0, W * 0.55, H * 0.4, Math.max(W, H) * 0.8);
    g.addColorStop(0, '#111a2c'); g.addColorStop(1, '#05070d');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    var n = Math.round(cloth.w * cloth.h / 2400);
    for (var i = 0; i < n; i++) {
      x.fillStyle = 'rgba(210,225,255,' + (0.12 + Math.random() * 0.5).toFixed(2) + ')';
      var s = (Math.random() < 0.1 ? 1.6 : 0.9) * cloth.dpr;
      x.fillRect(Math.random() * W, Math.random() * H, s, s);
    }
    cloth.bg = bg;
    clothDraw();
  }
  // Flag rectangle on screen, in device pixels.
  function clothRect() {
    var d = cloth.dpr, W = cloth.w, H = cloth.h;
    // Keep the top band free for the banner name; on a phone it is taller.
    var narrow = W < 600, topBand = saverOn ? H * 0.12 : narrow ? 104 : Math.max(H * 0.2, 90);
    var fw = Math.min(W * (narrow ? 0.74 : 0.66), (H - topBand - H * 0.12) * 1.5), fh = fw / 1.5;
    var x0 = (W - fw) / 2 + W * 0.02, y0 = Math.max(topBand, (H - fh) / 2 - H * 0.04);
    return { x: x0 * d, y: y0 * d, w: fw * d, h: fh * d };
  }
  function clothDraw() {
    var x = cloth.ctx; if (!x || !cloth.bg) return;
    var R = clothRect(), d = cloth.dpr, W = cloth.canvas.width, H = cloth.canvas.height;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.drawImage(cloth.bg, 0, 0);
    if (!cloth.tex) return;
    if (cloth.view === 'flat') {
      x.save(); x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 30 * d; x.shadowOffsetY = 12 * d;
      x.drawImage(cloth.tex, R.x, R.y, R.w, R.h); x.restore();
      return;
    }
    // Pole.
    var px = R.x - 5 * d, top = R.y - 18 * d;
    var pg = x.createLinearGradient(px - 4 * d, 0, px + 4 * d, 0);
    pg.addColorStop(0, '#5d6678'); pg.addColorStop(0.45, '#d7dde8'); pg.addColorStop(1, '#4a5263');
    x.fillStyle = pg; x.fillRect(px - 3 * d, top, 6 * d, H - top);
    var L = cloth.lctx, N = cloth.N, tw = cloth.TW, th = cloth.TH, t = cloth.t, wind = cloth.wind;
    L.setTransform(1, 0, 0, 1, 0, 0); L.clearRect(0, 0, W, H);
    var amp = R.h * (0.03 + 0.08 * wind), k = 1.6 + wind * 0.8, w = 2.2 + wind * 4.2;
    var droop = (1 - wind) * R.h * 0.42;
    var xs = [], ys = [], hs = [], sl = [];
    for (var i = 0; i <= N; i++) {
      var u = i / N, env = Math.pow(u, 0.85);
      var ph = (k * u - t * w / (Math.PI * 2)) * Math.PI * 2;
      var wave = Math.sin(ph) + 0.35 * Math.sin(ph * 2.1 + 1.3);
      var dw = Math.cos(ph) + 0.35 * 2.1 * Math.cos(ph * 2.1 + 1.3);
      xs.push(R.x + R.w * u * (1 - 0.07 * wind) - R.w * 0.03 * env * Math.abs(Math.sin(ph)));
      ys.push(R.y + amp * env * wave + droop * u * u);
      hs.push(R.h * (1 - 0.07 * env * (1 + Math.cos(ph)) * (0.4 + wind) * 0.5) - droop * u * u * 0.35);
      sl.push(dw * env);
    }
    var sw = tw / N;
    for (i = 0; i < N; i++) {
      var dx = xs[i + 1] - xs[i];
      L.setTransform(dx / sw, (ys[i + 1] - ys[i]) / sw, 0, hs[i] / th, xs[i] - (dx / sw) * (i * sw), ys[i] - ((ys[i + 1] - ys[i]) / sw) * (i * sw));
      L.drawImage(cloth.tex, i * sw, 0, sw, th, i * sw, 0, sw + 2, th);
    }
    // Shade with one smooth horizontal gradient: dark where the slope faces
    // away from the light, bright where it faces it.
    L.setTransform(1, 0, 0, 1, 0, 0);
    L.globalCompositeOperation = 'source-atop';
    var span = xs[N] - xs[0] || 1, sg = L.createLinearGradient(xs[0], 0, xs[N], 0);
    for (i = 0; i <= N; i += 2) {
      var s = sl[i] * (0.18 + 0.2 * wind), at = Math.max(0, Math.min(1, (xs[i] - xs[0]) / span));
      sg.addColorStop(at, s > 0 ? 'rgba(0,0,0,' + Math.min(0.45, s).toFixed(3) + ')' : 'rgba(255,255,255,' + Math.min(0.22, -s * 0.6).toFixed(3) + ')');
    }
    L.fillStyle = sg; L.fillRect(0, 0, W, H);
    L.globalCompositeOperation = 'source-over';
    L.setTransform(1, 0, 0, 1, 0, 0);
    x.save(); x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 24 * d; x.shadowOffsetY = 10 * d;
    x.drawImage(cloth.layer, 0, 0); x.restore();
    // Finial.
    var fg = x.createRadialGradient(px - 2 * d, top - 3 * d, 0, px, top, 8 * d);
    fg.addColorStop(0, '#fff6d0'); fg.addColorStop(0.5, '#ffc832'); fg.addColorStop(1, '#8a6410');
    x.fillStyle = fg; x.beginPath(); x.arc(px, top, 7 * d, 0, Math.PI * 2); x.fill();
  }
  function clothKick() {
    var want = cloth.view === 'wave' && !cloth.paused && cloth.visible && cloth.onScreen;
    if (!want) { cloth.running = false; clothDraw(); return; }
    if (cloth.running) return;
    cloth.running = true; cloth.last = 0;
    requestAnimationFrame(clothFrame);
  }
  function clothFrame(now) {
    if (!cloth.running) return;
    if (cloth.view !== 'wave' || cloth.paused || !cloth.visible || !cloth.onScreen) { cloth.running = false; return; }
    var dt = cloth.last ? Math.min(0.05, (now - cloth.last) / 1000) : 0.016;
    cloth.last = now; cloth.t += dt * cloth.tScale;
    clothDraw();
    requestAnimationFrame(clothFrame);
  }

  // ── BOOT ──
  function boot() {
    readCatalog();
    readHash();
    buildPicker();
    buildSheet();
    buildPresets();
    buildPatterns();
    buildShapes();
    buildEmblems();
    clothInit();
    $('btnPng').addEventListener('click', exportPng);
    $('btnLink').addEventListener('click', copyLink);
    window.addEventListener('hashchange', function () { readHash(); schedulePaint(); });
    paint();
    clothKick();
    // Glyph metrics change when the web fonts arrive; rebuild the masks then.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { maskCache = {}; maskKeys = []; schedulePaint(); });
  }
  // ── SCREENSAVER HOOK ──
  // The shell (lib/screensaver.js) calls enter() in screensaver mode. It pins
  // #heroWrap full frame, so the ResizeObserver sizes the canvas, and hides
  // the rest of the page. The seed picks the banner. The calm value lowers
  // the wind and slows the wave.
  window.snSaver = {
    enter: function (opts) {
      var calm = Math.max(0, Math.min(1, opts && opts.calm != null ? opts.calm : 0.7));
      var p = PRESETS[((opts && opts.seed) || 0) % PRESETS.length];
      saverOn = true;
      var st = document.createElement('style');
      st.textContent = 'html, body { overflow: hidden !important; }' +
        'header.top, #panel, .hero-meta, .hero-bar, .toast { display: none !important; }' +
        '.card.hero { backdrop-filter: none; -webkit-backdrop-filter: none; overflow: visible; border: 0; }' +
        '#heroWrap { position: fixed; inset: 0; height: auto; z-index: 100; cursor: none; }';
      document.head.appendChild(st);
      setState({ c1: p[1], c2: p[2], c3: p[3], ce: p[4], pattern: p[5], shape: p[6], emblem: p[7], size: 50, pos: 'center' });
      cloth.view = 'wave'; cloth.paused = false; cloth.onScreen = true;
      cloth.wind = 0.25 + 0.3 * (1 - calm);
      cloth.tScale = 1 - 0.5 * calm;
      clothResize(); clothKick();
      return { canvas: cloth.canvas, warmupMs: 500 };
    }
  };

  boot();
})();
