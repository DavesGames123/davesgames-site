// ============================================================================
//  SHIP DESIGNER  ·  livery painter with a flying fleet
// ----------------------------------------------------------------------------
//  A classic script. It loads three ship layers (hull, cockpit, accents) and
//  their tint masks as webp files from media/sprites/ship-livery/. The paths
//  come from window.SN_DATA (lib/game-data/catalog.js) when it is present.
//  Three colours paint the ship: hull, trim (a second hull tone inside a trim
//  pattern) and accent. The cockpit keeps its own colours. The presets are
//  the game liveries from liveries.js (window.SDLiveries).
//
//  LIGHT  In the Lit look, shade.js (window.SDShade) lights the flat
//  composite with one sun, as the game lights its ships. The surface (normal
//  map, occlusion, materials) comes once from the layer pixels, at 512 for
//  the hero and at 128 for the fleet and the preset buttons. The sun dial
//  sets the sun plane angle and height; Auto turns the sun slowly. The fleet
//  uses FLEET_BINS sprites, each lit from one plane angle in the sprite
//  frame, so a ship that turns, or a sun that turns, costs no new shading.
//  The Flat look shows the composite with no light. A page from file:// has
//  tainted canvases, so the Lit look is off there.
//
//  LAYER STACK   (bottom to top, built by composeShip)
//      hull grey   + hull colour   (overlay)  cut to the hull mask
//      hull grey   + trim colour   (overlay)  cut to hull mask AND trim pattern
//      cockpit                     (normal)   cut to the cockpit mask
//      accent grey + accent colour (overlay)  cut to the accent mask
//
//  DATA PATH
//      control input -> setColour / setTrim -> state -> schedulePaint()
//      paint() -> composeShip(512) -> relight() -> #shipCanvas
//              -> composeShip(128) -> rebuildFleet() -> fleet sprites
//              -> URL hash
//      sun dial -> setSun() -> scheduleRelight(); a new sun height also
//      rebuilds the fleet sprites (scheduleBins).
//      fleet.frame() runs only while the fleet card is on screen, the tab is
//      visible and the user has not paused it.
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//      layer paths ........ "var LAYER_FALLBACK"
//      presets ............ "var PRESETS"   (table in liveries.js)
//      trim patterns ...... "var TRIMS"
//      state .............. "var state"
//      colour maths ....... "function hexToRgb"
//      compositing ........ "function composeShip"
//      lighting ........... "var lit ="  "function relight"  "function rebuildFleet"
//      sun dial ........... "function buildSun"
//      paint and sync ..... "function paint"
//      URL hash ........... "function readHash"   (old links: "migrate")
//      preset grid ........ "function buildPresets"
//      colour picker ...... "function buildPicker"
//      bottom sheet ....... "function buildSheet"
//      PNG export ......... "function exportPng"
//      fleet simulation ... "var fleet"
//      screensaver hook ... "window.snSaver"
//      boot ............... "function boot"
// ============================================================================

(function () {
  'use strict';

  // ── LAYER PATHS ──
  // Fallback paths, relative to stella-nova/. The catalog gives the same paths.
  var LAYER_FALLBACK = {
    hull: ['media/sprites/ship-livery/hull.webp', 'media/sprites/ship-livery/hull-mask.webp'],
    cockpit: ['media/sprites/ship-livery/cockpit.webp', 'media/sprites/ship-livery/cockpit-mask.webp'],
    accents: ['media/sprites/ship-livery/accents.webp', 'media/sprites/ship-livery/accents-mask.webp']
  };
  var ROOT = '../../';

  function layerPaths() {
    var out = {};
    var data = window.SN_DATA;
    Object.keys(LAYER_FALLBACK).forEach(function (slug) {
      var paths = LAYER_FALLBACK[slug];
      if (data && data.entries) {
        for (var i = 0; i < data.entries.length; i++) {
          var e = data.entries[i];
          if (e.id === 'ship-livery/' + slug && e.sprites && e.sprites.length >= 2) { paths = e.sprites; break; }
        }
      }
      out[slug] = { base: ROOT + paths[0], mask: ROOT + paths[1] };
    });
    return out;
  }

  // ── PRESETS ──
  // The game liveries: [name, hull, accent], from liveries.js. The trim
  // colour of a preset is a darker tone of the hull, and the trim pattern is
  // 'none'. The fallback is the first game livery only, for a page where
  // liveries.js did not load.
  var LIV = window.SDLiveries || null;
  var PRESETS = LIV ? LIV.CURRENT : [['Viper', '#4ac86e', '#ffc832']];

  // Quick swatches in the picker.
  var QUICK = ['#f2f4f8', '#9aa3b2', '#2a2f3a', '#0c0e14', '#d23a3a', '#ff8a2a', '#ffc832', '#7bd13b',
               '#1fa37a', '#2bc4e0', '#2f6fe0', '#6a4ae0', '#c04ad8', '#ff5aa5', '#8b5a2b', '#c9b48a'];

  // ── TRIM PATTERNS ──
  // Each draws a white region in a 512 x 512 ship frame. The ship nose points
  // up and the centre line is x = 256. The trim colour shows only where the
  // region and the hull mask both have alpha.
  var TRIMS = [
    { id: 'none', name: 'None', draw: null },
    { id: 'spine', name: 'Spine', draw: function (x) { x.fillRect(232, 0, 48, 512); } },
    { id: 'nose', name: 'Nose', draw: function (x) { x.fillRect(0, 0, 512, 180); } },
    { id: 'wings', name: 'Wings', draw: function (x) { x.fillRect(0, 0, 176, 512); x.fillRect(336, 0, 176, 512); } },
    { id: 'tail', name: 'Tail', draw: function (x) { x.fillRect(0, 330, 512, 182); } },
    { id: 'split', name: 'Split', draw: function (x) { x.fillRect(256, 0, 256, 512); } },
    { id: 'chevron', name: 'Chevron', draw: function (x) {
      x.beginPath(); x.moveTo(0, 210); x.lineTo(256, 120); x.lineTo(512, 210); x.lineTo(512, 270);
      x.lineTo(256, 180); x.lineTo(0, 270); x.closePath(); x.fill();
    } }
  ];

  // ── STATE ──
  // The page opens on the first game livery.
  var state = { hull: PRESETS[0][1], trim: '#000000', accent: PRESETS[0][2], pattern: 'none', channel: 'hull' };
  var layers = null;        // { hull: {base, mask}, ... } decoded Image objects
  var shipFull = null;      // 512 x 512 flat composite (offscreen)
  var shipSmall = null;     // 128 x 128 flat composite for the fleet

  function $(id) { return document.getElementById(id); }

  // ── COLOUR MATHS ──
  function hexToRgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHex(r, g, b) {
    return '#' + ((1 << 24) + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b)).toString(16).slice(1);
  }
  function normHex(v) {
    v = String(v || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(v)) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
    return /^[0-9a-f]{6}$/i.test(v) ? '#' + v.toLowerCase() : null;
  }
  function toHsv(hex) {
    var c = hexToRgb(hex), r = c.r / 255, g = c.g / 255, b = c.b / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h: h, s: mx ? d / mx : 0, v: mx };
  }
  function fromHsv(h, s, v) {
    var f = function (n) { var k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return rgbToHex(f(5) * 255, f(3) * 255, f(1) * 255);
  }
  function shade(hex, k) {
    var c = hexToRgb(hex);
    return rgbToHex(c.r * k, c.g * k, c.b * k);
  }
  state.trim = shade(state.hull, 0.55);

  // ── COMPOSITING ──
  function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; }

  // Paint one grey layer with a colour (overlay blend) and cut it to a mask.
  // region, when given, is a second mask canvas that also cuts the result.
  function tintLayer(base, mask, colour, S, region) {
    var c = makeCanvas(S), x = c.getContext('2d');
    x.drawImage(base, 0, 0, S, S);
    x.globalCompositeOperation = 'overlay';
    x.fillStyle = colour; x.fillRect(0, 0, S, S);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(mask, 0, 0, S, S);
    if (region) x.drawImage(region, 0, 0, S, S);
    return c;
  }
  function cutLayer(base, mask, S) {
    var c = makeCanvas(S), x = c.getContext('2d');
    x.drawImage(base, 0, 0, S, S);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(mask, 0, 0, S, S);
    return c;
  }
  var regionCache = {};
  function trimRegion(id) {
    if (regionCache[id] !== undefined) return regionCache[id];
    var t = null;
    for (var i = 0; i < TRIMS.length; i++) if (TRIMS[i].id === id) t = TRIMS[i];
    if (!t || !t.draw) return (regionCache[id] = null);
    var c = makeCanvas(512), x = c.getContext('2d');
    x.fillStyle = '#fff'; t.draw(x);
    return (regionCache[id] = c);
  }

  // Build the ship at S x S pixels from a colour set { hull, trim, accent, pattern }.
  function composeShip(S, set, out) {
    var c = out || makeCanvas(S);
    c.width = S; c.height = S;
    var x = c.getContext('2d');
    x.clearRect(0, 0, S, S);
    if (!layers) return c;
    x.drawImage(tintLayer(layers.hull.base, layers.hull.mask, set.hull, S), 0, 0);
    var region = trimRegion(set.pattern);
    if (region) x.drawImage(tintLayer(layers.hull.base, layers.hull.mask, set.trim, S, region), 0, 0);
    x.drawImage(cutLayer(layers.cockpit.base, layers.cockpit.mask, S), 0, 0);
    x.drawImage(tintLayer(layers.accents.base, layers.accents.mask, set.accent, S), 0, 0);
    return c;
  }

  // ── LIGHTING ──
  // lit.on is the look the user picked (Lit or Flat). lit.ok is false when
  // shade.js is missing or the layer pixels cannot be read (file://).
  var SH = window.SDShade || null;
  var SMALL = 128, FLEET_BINS = 24;
  var EL_MIN = 0.12, EL_MAX = 1.35;           // sun height range, radians
  var THUMB_SUN = { az: -2.3, el: 0.5 };      // fixed sun of the preset buttons
  var sun = { az: -2.25, el: 0.42, auto: false };
  // A quick relight (a dial drag, Auto on a phone) shades the 256 surface
  // and scales it up; QUICK_IDLE ms after the last quick one, a full 512
  // relight follows.
  var MID = 256, QUICK_IDLE = 160;
  var lit = {
    on: true, ok: !!SH, surf: null, surfMid: null, surfSmall: null,
    px: {}, cv: {}, img: {}, full: null, bins: null, binsEl: null, relights: 0, quick: 0,
    lite: !!(window.matchMedia && window.matchMedia('(hover: none)').matches)
  };
  function sunVec() { return SH.lightDir(sun.az, sun.el); }
  function heroLit() { return !!(lit.on && lit.ok && lit.surf); }
  function wrapAz(a) { a = a % (2 * Math.PI); if (a > Math.PI) a -= 2 * Math.PI; if (a < -Math.PI) a += 2 * Math.PI; return a; }

  // RGBA pixels of the six layer images at S x S.
  function layerPixels(S) {
    var c = makeCanvas(S), x = c.getContext('2d'), out = {};
    function px(img) { x.clearRect(0, 0, S, S); x.drawImage(img, 0, 0, S, S); return x.getImageData(0, 0, S, S).data; }
    out.hull = px(layers.hull.base); out.hullMask = px(layers.hull.mask);
    out.cockpit = px(layers.cockpit.base); out.cockpitMask = px(layers.cockpit.mask);
    out.accents = px(layers.accents.base); out.accentsMask = px(layers.accents.mask);
    return out;
  }
  function litFail() {
    lit.ok = false; lit.surf = lit.surfSmall = null;
    syncLook();
    toast('Lit view needs the page served over http');
  }
  // Build the three surfaces after the first flat paint, so that the page
  // shows the ship at once. The small ones come first: they are quick.
  function buildSurfaces(done) {
    if (!SH) { lit.ok = false; syncLook(); return; }
    try {
      lit.surfSmall = SH.buildSurface(layerPixels(SMALL), SMALL, SMALL);
      lit.surfMid = SH.buildSurface(layerPixels(MID), MID, MID);
    } catch (e) { litFail(); return; }
    setTimeout(function () {
      try { lit.surf = SH.buildSurface(layerPixels(512), 512, 512); }
      catch (e) { litFail(); return; }
      done();
    }, 0);
  }

  // Draw the hero: the lit ship with a soft drop shadow away from the sun,
  // or the flat composite.
  // The flat composite pixels at size S (cached until the next paint).
  function flatPixels(S) {
    if (lit.px[S]) return lit.px[S];
    var c = shipFull;
    if (S !== 512) {
      c = makeCanvas(S);
      var cx = c.getContext('2d');
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(shipFull, 0, 0, S, S);
    }
    return (lit.px[S] = c.getContext('2d').getImageData(0, 0, S, S).data);
  }
  var idleTimer = 0;
  function relight(quick) {
    var cv = $('shipCanvas'), x = cv.getContext('2d');
    if (!x || !shipFull) return;
    clearTimeout(idleTimer);
    x.clearRect(0, 0, 512, 512);
    if (!heroLit()) { x.drawImage(shipFull, 0, 0); return; }
    var q = !!(quick && lit.surfMid), S = q ? MID : 512, surf = q ? lit.surfMid : lit.surf;
    var c = lit.cv[S] || (lit.cv[S] = makeCanvas(S)), lx = c.getContext('2d');
    var img = lit.img[S] || (lit.img[S] = lx.createImageData(S, S));
    var L = sunVec();
    SH.shade(flatPixels(S), surf, L, { steps: q ? 5 : lit.lite ? 6 : 10 }, img.data);
    lx.putImageData(img, 0, 0);
    x.save();
    x.imageSmoothingQuality = 'high';
    x.shadowColor = 'rgba(0, 0, 0, 0.6)';
    x.shadowBlur = 20;
    x.shadowOffsetX = -L.x * 16; x.shadowOffsetY = -L.y * 16;
    x.drawImage(c, 0, 0, 512, 512);
    x.restore();
    if (q) { lit.quick++; idleTimer = setTimeout(function () { relight(false); }, QUICK_IDLE); }
    else { lit.full = c; lit.relights++; }
  }
  var relightQueued = false, relightQuick = false;
  function scheduleRelight(quick) {
    relightQuick = relightQueued ? relightQuick && !!quick : !!quick;
    if (relightQueued) return;
    relightQueued = true;
    (window.requestAnimationFrame || setTimeout)(function () { relightQueued = false; relight(relightQuick); });
  }

  // Fleet sprites: FLEET_BINS copies of the small composite, bin i lit from
  // plane angle 2 PI i / FLEET_BINS in the sprite frame, at the sun height.
  function rebuildFleet() {
    if (!(lit.on && lit.ok && lit.surfSmall && shipSmall)) { lit.bins = null; return; }
    var px = shipSmall.getContext('2d').getImageData(0, 0, SMALL, SMALL).data;
    var bins = lit.bins || [], buf = null;
    for (var i = 0; i < FLEET_BINS; i++) {
      var c = bins[i] || makeCanvas(SMALL), x = c.getContext('2d');
      var img = buf || (buf = x.createImageData(SMALL, SMALL));
      SH.shade(px, lit.surfSmall, SH.lightDir(i / FLEET_BINS * 2 * Math.PI, sun.el), { steps: 5 }, img.data);
      x.putImageData(img, 0, 0);
      bins[i] = c;
    }
    lit.bins = bins; lit.binsEl = sun.el;
  }
  // The fleet sprite bin for a ship drawn with canvas rotation rot.
  function fleetBin(rot) {
    var t = wrapAz(sun.az - rot) / (2 * Math.PI) * FLEET_BINS;
    return ((Math.round(t) % FLEET_BINS) + FLEET_BINS) % FLEET_BINS;
  }
  var binsTimer = 0;
  function scheduleBins() {
    clearTimeout(binsTimer);
    binsTimer = setTimeout(function () { rebuildFleet(); fleetKick(); }, 120);
  }

  // Preset buttons: lit from THUMB_SUN in the Lit look, flat in the Flat look.
  var thumbs = [];
  function drawThumbs() {
    var lt = lit.on && lit.ok && lit.surfSmall, c128 = lt ? makeCanvas(SMALL) : null, img = null;
    thumbs.forEach(function (t) {
      var set = { hull: t.p[1], trim: t.p[1], accent: t.p[2], pattern: 'none' };
      var x = t.canvas.getContext('2d');
      if (!x) return;
      x.clearRect(0, 0, 96, 96);
      if (!lt) { composeShip(96, set, t.canvas); return; }
      composeShip(SMALL, set, c128);
      var cx = c128.getContext('2d');
      img = img || cx.createImageData(SMALL, SMALL);
      SH.shade(cx.getImageData(0, 0, SMALL, SMALL).data, lit.surfSmall, SH.lightDir(THUMB_SUN.az, THUMB_SUN.el), { steps: 5 }, img.data);
      cx.putImageData(img, 0, 0);
      x.imageSmoothingQuality = 'high';
      x.drawImage(c128, 0, 0, 96, 96);
    });
  }

  // ── PAINT AND SYNC ──
  var paintQueued = false;
  function schedulePaint() {
    if (paintQueued) return;
    paintQueued = true;
    (window.requestAnimationFrame || setTimeout)(function () { paintQueued = false; paint(); });
  }
  function paint() {
    shipFull = composeShip(512, state, shipFull);
    lit.px = {};
    shipSmall = shipSmall || makeCanvas(SMALL);
    var sx = shipSmall.getContext('2d');
    sx.clearRect(0, 0, SMALL, SMALL);
    sx.imageSmoothingQuality = 'high';
    sx.drawImage(shipFull, 0, 0, SMALL, SMALL);
    relight();
    // The fleet sprites follow a little later, so that a colour drag stays
    // smooth: 24 small shades on each move would cost more than the hero.
    if (lit.bins) scheduleBins(); else rebuildFleet();
    syncUi();
    if (!saverOn) writeHash();
  }
  function presetName() {
    for (var i = 0; i < PRESETS.length; i++) {
      var p = PRESETS[i];
      if (p[1] === state.hull && p[2] === state.accent && state.pattern === 'none') return p[0];
    }
    return null;
  }
  function syncUi() {
    var name = presetName();
    $('liveryName').textContent = name || 'Custom';
    document.querySelectorAll('.preset').forEach(function (el) { el.classList.toggle('on', el.dataset.name === name); });
    var chips = [['Hull', state.hull], ['Trim', state.trim], ['Accent', state.accent]];
    if (state.pattern === 'none') chips.splice(1, 1);
    $('heroChips').innerHTML = chips.map(function (c) {
      return '<span><i style="background:' + c[1] + '"></i><b>' + c[0] + '</b></span>';
    }).join('');
    var rgb = hexToRgb(state.hull);
    $('heroGlow').style.setProperty('--hull-glow', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',.55)');
    document.querySelectorAll('#channels button').forEach(function (b) {
      b.querySelector('i').style.background = state[b.dataset.ch];
      b.classList.toggle('on', b.dataset.ch === state.channel);
      b.setAttribute('aria-checked', b.dataset.ch === state.channel ? 'true' : 'false');
    });
    document.querySelectorAll('#trimSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.trim === state.pattern); });
    picker.show(state[state.channel]);
  }
  function setColour(ch, hex) { state[ch] = hex; schedulePaint(); }
  function applyPreset(p) {
    state.hull = p[1]; state.accent = p[2]; state.trim = shade(p[1], 0.55); state.pattern = 'none';
    schedulePaint();
  }

  // ── URL HASH ──
  // Format: #v=2&hull=4ac86e&trim=296e3d&accent=ffc832&pattern=spine
  // plus &look=flat in the Flat look. A link with no v is from before the
  // game liveries (2026-10-18): when its hull and accent are an old preset,
  // migrate() moves it to the game livery of the same name (or the nearest
  // one) and a toast tells the user. Custom colours load as they are.
  function readHash() {
    var h = (location.hash || '').replace(/^#/, '');
    if (!h) return null;
    var got = {};
    h.split('&').forEach(function (kv) {
      var p = kv.split('='), k = p[0], v = decodeURIComponent(p[1] || '');
      got[k] = v;
      if (k === 'hull' || k === 'trim' || k === 'accent') { var c = normHex(v); if (c) state[k] = c; }
      if (k === 'pattern' && TRIMS.some(function (t) { return t.id === v; })) state.pattern = v;
      if (k === 'look') lit.on = v !== 'flat';
    });
    if (got.v) lit.on = got.look !== 'flat';
    if (got.v || !LIV || !got.hull) return null;
    var m = LIV.migrate(state.hull, state.accent);
    if (!m) return null;
    state.hull = m.to[1]; state.accent = m.to[2];
    if (state.pattern === 'none') state.trim = shade(state.hull, 0.55);
    return m;
  }
  function migrateNote(m) {
    if (!m) return;
    toast(m.by === 'name' ? 'Old link: ' + m.from[0] + ' now has the game colours'
      : 'Old link: ' + m.from[0] + ' is now ' + m.to[0]);
  }
  function hashString() {
    return 'v=2&hull=' + state.hull.slice(1) + '&trim=' + state.trim.slice(1) + '&accent=' + state.accent.slice(1) +
      '&pattern=' + state.pattern + (lit.on ? '' : '&look=flat');
  }
  var hashTimer = 0;
  var saverOn = false;   // screensaver mode: no hash writes
  function writeHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(function () {
      try { history.replaceState(null, '', '#' + hashString()); } catch (e) { /* file:// in some browsers */ }
    }, 250);
  }
  function shareUrl() { return location.href.split('#')[0] + '#' + hashString(); }

  // ── TOAST ──
  var toastTimer = 0;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  // ── PRESET GRID ──
  // One button per preset, with a 96 px thumbnail of the painted ship.
  function buildPresets() {
    var grid = $('presetGrid');
    thumbs = [];
    PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'preset'; b.dataset.name = p[0];
      b.setAttribute('aria-label', 'Livery ' + p[0]);
      var c = makeCanvas(96);
      thumbs.push({ p: p, canvas: c });
      var s = document.createElement('span'); s.textContent = p[0];
      b.appendChild(c); b.appendChild(s);
      b.addEventListener('click', function () { applyPreset(p); });
      grid.appendChild(b);
    });
    drawThumbs();
  }

  // ── COLOUR PICKER ──
  // One SV square and one hue bar edit the selected channel. Pointer capture
  // keeps a drag active outside the element, for mouse, pen and touch.
  var picker = { show: function () {} };
  function buildPicker() {
    var sv = $('sv'), hue = $('hue'), hexIn = $('hexInput');
    var svKnob = sv.querySelector('.knob'), hueKnob = hue.querySelector('.knob');
    var hsv = toHsv(state[state.channel]);

    function render(hex) {
      sv.style.setProperty('--hue', Math.round(hsv.h));
      svKnob.style.left = (hsv.s * 100) + '%';
      svKnob.style.top = ((1 - hsv.v) * 100) + '%';
      svKnob.style.background = hex;
      hueKnob.style.left = (hsv.h / 360 * 100) + '%';
      hueKnob.style.background = 'hsl(' + Math.round(hsv.h) + ',100%,50%)';
      $('curSwatch').style.background = hex;
      if (document.activeElement !== hexIn) hexIn.value = hex.toUpperCase();
    }
    picker.show = function (hex) {
      var next = toHsv(hex);
      // Keep the hue when the colour is grey or black, so the knob does not jump.
      if (next.s < 0.005 || next.v < 0.005) next.h = hsv.h;
      if (next.v < 0.005) next.s = hsv.s;
      if (fromHsv(hsv.h, hsv.s, hsv.v) !== hex) hsv = next;
      render(hex);
    };
    function commit() { setColour(state.channel, fromHsv(hsv.h, hsv.s, hsv.v)); }
    function drag(el, onMove) {
      el.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        onMove(e);
        function move(ev) { onMove(ev); }
        function up() {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
        }
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
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
      var c = normHex(hexIn.value);
      if (c) { hsv = toHsv(c); setColour(state.channel, c); } else hexIn.value = state[state.channel].toUpperCase();
    });
    hexIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') hexIn.blur(); });

    var quick = $('quick');
    QUICK.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button'; b.style.background = c; b.setAttribute('aria-label', 'Colour ' + c);
      b.addEventListener('click', function () { hsv = toHsv(c); setColour(state.channel, c); });
      quick.appendChild(b);
    });
    document.querySelectorAll('#channels button').forEach(function (b) {
      b.setAttribute('role', 'radio');
      b.addEventListener('click', function () {
        state.channel = b.dataset.ch;
        hsv = toHsv(state[state.channel]);
        syncUi();
      });
    });

    var seg = $('trimSeg');
    TRIMS.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button'; b.dataset.trim = t.id; b.textContent = t.name;
      b.addEventListener('click', function () {
        state.pattern = t.id;
        if (t.id !== 'none' && state.channel === 'hull') state.channel = 'trim';
        hsv = toHsv(state[state.channel]);
        schedulePaint();
      });
      seg.appendChild(b);
    });

    $('btnSwap').addEventListener('click', function () {
      var h = state.hull; state.hull = state.accent; state.accent = h;
      hsv = toHsv(state[state.channel]); schedulePaint();
    });
    $('btnRandom').addEventListener('click', function () {
      var h = Math.random() * 360;
      state.hull = fromHsv(h, 0.35 + Math.random() * 0.55, 0.2 + Math.random() * 0.6);
      state.trim = fromHsv((h + 18) % 360, 0.4 + Math.random() * 0.5, 0.15 + Math.random() * 0.5);
      state.accent = fromHsv((h + 150 + Math.random() * 60) % 360, 0.6 + Math.random() * 0.4, 0.75 + Math.random() * 0.25);
      state.pattern = TRIMS[1 + Math.floor(Math.random() * (TRIMS.length - 1))].id;
      hsv = toHsv(state[state.channel]); schedulePaint();
    });
  }

  // ── TABS AND BOTTOM SHEET ──
  // The tabs switch the panel body. On a phone the panel is a bottom sheet:
  // a tap on a tab opens it, the grip toggles it, and a drag moves it.
  function buildSheet() {
    var panel = $('panel'), grip = $('grip');
    var phone = window.matchMedia('(max-width: 900px)');
    function setTab(id) {
      document.querySelectorAll('.tabs button').forEach(function (b) {
        b.classList.toggle('on', b.dataset.tab === id);
        b.setAttribute('aria-selected', b.dataset.tab === id ? 'true' : 'false');
      });
      document.querySelectorAll('.tab-body').forEach(function (el) { el.hidden = el.dataset.body !== id; });
    }
    // On a phone, scroll so that the hero ship sits in the free space above
    // the open sheet. Then each colour change shows at once.
    function open() {
      panel.classList.add('sheet-open');
      // A landscape phone shows the panel as a side column (style.css), not
      // as a sheet. Then the hero is already in view and no scroll is necessary.
      if (getComputedStyle(panel).position !== 'fixed') return;
      var r = $('shipCanvas').getBoundingClientRect();
      var free = window.innerHeight - panel.getBoundingClientRect().height;
      var dy = r.top + r.height / 2 - free / 2;
      if (Math.abs(dy) > 8) window.scrollBy({ top: dy, behavior: 'smooth' });
    }
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        setTab(b.dataset.tab);
        if (phone.matches && !panel.classList.contains('sheet-open')) open();
      });
    });
    function toggle() { if (panel.classList.contains('sheet-open')) panel.classList.remove('sheet-open'); else open(); }
    grip.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });

    var startY = 0, startOpen = false, moved = false, h = 0;
    grip.addEventListener('pointerdown', function (e) {
      if (!phone.matches) return;
      grip.setPointerCapture(e.pointerId);
      startY = e.clientY; startOpen = panel.classList.contains('sheet-open'); moved = false;
      h = panel.getBoundingClientRect().height;
      panel.classList.add('dragging');
    });
    grip.addEventListener('pointermove', function (e) {
      if (!panel.classList.contains('dragging')) return;
      var dy = e.clientY - startY;
      if (Math.abs(dy) > 4) moved = true;
      var peek = 108, closed = h - peek;
      var y = Math.max(0, Math.min(closed, (startOpen ? 0 : closed) + dy));
      panel.style.transform = 'translateY(' + y + 'px)';
    });
    function end(e) {
      if (!panel.classList.contains('dragging')) return;
      panel.classList.remove('dragging');
      panel.style.transform = '';
      var dy = e.clientY - startY;
      if (!moved) toggle();
      else if (startOpen && dy > 60) panel.classList.remove('sheet-open');
      else if (!startOpen && dy < -60) open();
    }
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  // ── PNG EXPORT ──
  function exportPng() {
    if (!layers) return;
    var c;
    if (heroLit()) relight(false);
    if (heroLit() && lit.full) {
      c = makeCanvas(1024);
      var cx = c.getContext('2d');
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(lit.full, 0, 0, 1024, 1024);
    } else c = composeShip(1024, state);
    var name = 'stella-nova-livery-' + (presetName() || 'custom').toLowerCase() + '.png';
    try {
      c.toBlob(function (blob) {
        if (!blob) { toast('Export failed in this browser'); return; }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        toast('Saved ' + name);
      }, 'image/png');
    } catch (err) {
      // A canvas made from file:// images is tainted and cannot export.
      toast('Export needs the page served over http');
    }
  }
  function copyLink() {
    var url = shareUrl();
    function fallback() {
      var t = document.createElement('textarea');
      t.value = url; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      t.remove();
      toast(ok ? 'Link copied' : 'Copy failed: ' + url);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { toast('Link copied'); }, fallback);
    } else fallback();
  }

  // ── FLEET SIMULATION ──
  // Ships fly in a 2D field. In 'wander' each ship turns by a slow sum of
  // sines and keeps away from its neighbours; the field wraps at the edges.
  // In 'formation' the ships make squadrons of up to seven in a V shape that
  // follow a leader on a smooth closed path. A drag pushes the ships away.
  var fleet = {
    canvas: null, ctx: null, w: 0, h: 0, dpr: 1, ships: [], t: 0, last: 0,
    mode: 'wander', paused: false, visible: true, onScreen: true, running: false,
    count: 24, size: 44, speed: 1, glow: true, bg: null, flame: null, push: null,
    flick: 40   // engine flame flicker rate, rad per unit of fleet time
  };

  function fleetInit() {
    fleet.canvas = $('fleetCanvas');
    fleet.ctx = fleet.canvas.getContext('2d');
    fleet.flame = makeFlame();
    fleetResize();
    fleetSeed();
    if (window.ResizeObserver) new ResizeObserver(function () { fleetResize(); fleetKick(); }).observe($('fleetWrap'));
    else window.addEventListener('resize', function () { fleetResize(); fleetKick(); });
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (es) { fleet.onScreen = es[0].isIntersecting; fleetKick(); }, { threshold: 0.01 }).observe($('fleetWrap'));
    }
    document.addEventListener('visibilitychange', function () { fleet.visible = !document.hidden; fleetKick(); });

    var wrap = $('fleetWrap');
    wrap.addEventListener('pointerdown', function (e) {
      wrap.setPointerCapture(e.pointerId);
      setPush(e);
    });
    wrap.addEventListener('pointermove', function (e) { if (fleet.push) setPush(e); });
    function clear() { fleet.push = null; }
    wrap.addEventListener('pointerup', clear);
    wrap.addEventListener('pointercancel', clear);
    function setPush(e) {
      var r = wrap.getBoundingClientRect();
      fleet.push = { x: e.clientX - r.left, y: e.clientY - r.top };
      fleetKick();
    }

    document.querySelectorAll('#fleetMode button').forEach(function (b) {
      b.addEventListener('click', function () {
        fleet.mode = b.dataset.mode;
        document.querySelectorAll('#fleetMode button').forEach(function (o) { o.classList.toggle('on', o === b); });
        fleetKick();
      });
    });
    $('btnPause').addEventListener('click', function () {
      fleet.paused = !fleet.paused;
      this.setAttribute('aria-pressed', fleet.paused ? 'true' : 'false');
      this.textContent = fleet.paused ? 'Play' : 'Pause';
      fleetKick();
    });
    $('shipCount').addEventListener('input', function () {
      fleet.count = +this.value; $('shipCountVal').textContent = this.value; fleetSeed(); fleetKick();
    });
    $('shipSize').addEventListener('input', function () {
      fleet.size = +this.value; $('shipSizeVal').textContent = this.value + ' px'; fleetKick();
    });
    $('shipSpeed').addEventListener('input', function () {
      fleet.speed = +this.value; $('shipSpeedVal').textContent = (+this.value).toFixed(1) + 'x';
    });
    $('trails').addEventListener('change', function () { fleet.glow = this.checked; fleetKick(); });
  }

  function makeFlame() {
    var c = makeCanvas(32, 96), x = c.getContext('2d');
    var g = x.createLinearGradient(0, 0, 0, 96);
    g.addColorStop(0, 'rgba(255,240,200,0.95)');
    g.addColorStop(0.18, 'rgba(255,170,60,0.75)');
    g.addColorStop(0.55, 'rgba(255,90,20,0.25)');
    g.addColorStop(1, 'rgba(120,160,255,0)');
    x.fillStyle = g;
    x.beginPath(); x.moveTo(6, 0); x.quadraticCurveTo(16, 8, 26, 0); x.lineTo(16, 96); x.closePath(); x.fill();
    return c;
  }

  function fleetResize() {
    var r = $('fleetWrap').getBoundingClientRect();
    fleet.dpr = Math.min(window.devicePixelRatio || 1, 2);
    fleet.w = Math.max(1, r.width); fleet.h = Math.max(1, r.height);
    fleet.canvas.width = Math.round(fleet.w * fleet.dpr);
    fleet.canvas.height = Math.round(fleet.h * fleet.dpr);
    // Static backdrop: a deep gradient and a fixed star set, drawn once per size.
    var bg = makeCanvas(fleet.canvas.width, fleet.canvas.height), x = bg.getContext('2d');
    var g = x.createRadialGradient(bg.width * 0.5, bg.height * 0.4, 0, bg.width * 0.5, bg.height * 0.4, Math.max(bg.width, bg.height) * 0.75);
    g.addColorStop(0, '#0d1424'); g.addColorStop(1, '#05070d');
    x.fillStyle = g; x.fillRect(0, 0, bg.width, bg.height);
    var n = Math.round(fleet.w * fleet.h / 2600);
    for (var i = 0; i < n; i++) {
      var a = 0.15 + Math.random() * 0.6, s = (Math.random() < 0.1 ? 1.6 : 0.9) * fleet.dpr;
      x.fillStyle = 'rgba(210,225,255,' + a.toFixed(2) + ')';
      x.fillRect(Math.random() * bg.width, Math.random() * bg.height, s, s);
    }
    fleet.bg = bg;
    if (!fleet.running) fleetDraw();
  }

  function fleetSeed() {
    var old = fleet.ships, ships = [];
    for (var i = 0; i < fleet.count; i++) {
      var s = old[i] || {
        x: Math.random() * fleet.w, y: Math.random() * fleet.h,
        a: Math.random() * Math.PI * 2, p: Math.random() * 100,
        sp: 0.75 + Math.random() * 0.5, vx: 0, vy: 0
      };
      ships.push(s);
    }
    fleet.ships = ships;
  }

  // Angle of the sprite nose in sprite space: hull.webp points down (+y).
  var SPRITE_NOSE = Math.PI / 2;

  function wrapAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

  function fleetStep(dt) {
    var t = (fleet.t += dt * fleet.speed);
    var base = fleet.size * 1.4 * fleet.speed;
    var ships = fleet.ships, n = ships.length, i, j, s;
    if (fleet.mode === 'wander') {
      var sepR = fleet.size * 1.3;
      for (i = 0; i < n; i++) {
        s = ships[i];
        var turn = Math.sin(t * 0.7 + s.p) * 0.8 + Math.sin(t * 0.31 + s.p * 1.7) * 0.5;
        var ax = 0, ay = 0;
        for (j = 0; j < n; j++) {
          if (j === i) continue;
          var dx = s.x - ships[j].x, dy = s.y - ships[j].y, d2 = dx * dx + dy * dy;
          if (d2 < sepR * sepR && d2 > 0.01) { var d = Math.sqrt(d2), k = (sepR - d) / sepR; ax += dx / d * k; ay += dy / d * k; }
        }
        if (fleet.push) {
          var px = s.x - fleet.push.x, py = s.y - fleet.push.y, pd = Math.sqrt(px * px + py * py) || 1;
          if (pd < 160) { var pk = (160 - pd) / 160 * 3; ax += px / pd * pk; ay += py / pd * pk; }
        }
        if (ax || ay) turn += wrapAngle(Math.atan2(ay, ax) - s.a) * Math.min(1.5, Math.sqrt(ax * ax + ay * ay)) * 2;
        s.a = wrapAngle(s.a + turn * dt * 1.2);
        var v = base * s.sp;
        s.x += Math.cos(s.a) * v * dt; s.y += Math.sin(s.a) * v * dt;
        var m = fleet.size;
        if (s.x < -m) s.x += fleet.w + 2 * m; else if (s.x > fleet.w + m) s.x -= fleet.w + 2 * m;
        if (s.y < -m) s.y += fleet.h + 2 * m; else if (s.y > fleet.h + m) s.y -= fleet.h + 2 * m;
      }
    } else {
      var per = 7, squads = Math.ceil(n / per), gap = fleet.size * 1.15;
      for (i = 0; i < n; i++) {
        s = ships[i];
        var q = Math.floor(i / per), k2 = i % per;
        // Leader path: a closed curve inside the canvas, one phase per squadron.
        var ph = t * 0.22 + q * (Math.PI * 2 / squads);
        var cx = fleet.w * (0.5 + 0.36 * Math.sin(ph)), cy = fleet.h * (0.5 + 0.32 * Math.sin(ph * 2 + q));
        var tx = fleet.w * 0.36 * Math.cos(ph), ty = fleet.h * 0.64 * Math.cos(ph * 2 + q);
        var la = Math.atan2(ty, tx);
        var row = Math.ceil(k2 / 2), side = k2 % 2 ? -1 : 1;
        var back = -row * gap, lat = side * row * gap * 0.75;
        var gx = cx + Math.cos(la) * back - Math.sin(la) * lat;
        var gy = cy + Math.sin(la) * back + Math.cos(la) * lat;
        if (fleet.push) {
          var qx = gx - fleet.push.x, qy = gy - fleet.push.y, qd = Math.sqrt(qx * qx + qy * qy) || 1;
          if (qd < 140) { gx += qx / qd * (140 - qd); gy += qy / qd * (140 - qd); }
        }
        // Fly with the leader velocity, plus a spring toward the slot.
        var lv = 0.22 * fleet.speed;
        var ex = gx - s.x, ey = gy - s.y;
        var dvx = tx * lv + ex * 4 - s.vx, dvy = ty * lv + ey * 4 - s.vy;
        s.vx += dvx * Math.min(1, dt * 6); s.vy += dvy * Math.min(1, dt * 6);
        var sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy), max = base * 4;
        if (sp > max) { s.vx *= max / sp; s.vy *= max / sp; }
        s.x += s.vx * dt; s.y += s.vy * dt;
        // Face the flight path. The velocity is already smooth (the spring
        // above eases it), so the nose follows it closely. A ship that is
        // almost at rest faces the leader heading.
        var want = sp > 2 ? Math.atan2(s.vy, s.vx) : la;
        s.a = wrapAngle(s.a + wrapAngle(want - s.a) * Math.min(1, dt * 14));
      }
    }
  }

  function fleetDraw() {
    var x = fleet.ctx, d = fleet.dpr;
    if (!x) return;
    x.setTransform(1, 0, 0, 1, 0, 0);
    if (fleet.bg) x.drawImage(fleet.bg, 0, 0); else { x.fillStyle = '#05070d'; x.fillRect(0, 0, fleet.canvas.width, fleet.canvas.height); }
    if (!shipSmall) return;
    var sz = fleet.size, t = fleet.t, bins = lit.bins;
    for (var i = 0; i < fleet.ships.length; i++) {
      var s = fleet.ships[i];
      x.setTransform(d, 0, 0, d, s.x * d, s.y * d);
      // The sprite nose (the rounded intake) is at local +y and the engine
      // block is at local -y. Turn local +y onto the heading s.a.
      x.rotate(s.a - SPRITE_NOSE);
      if (fleet.glow) {
        x.globalCompositeOperation = 'lighter';
        var fl = 0.8 + 0.2 * Math.sin(t * fleet.flick + i * 1.7);
        x.globalAlpha = 0.85;
        // The flame comes out of the engine block, so mirror it onto -y.
        x.scale(1, -1);
        x.drawImage(fleet.flame, -sz * 0.09, sz * 0.4, sz * 0.18, sz * 0.55 * fl);
        x.scale(1, -1);
        x.globalAlpha = 1;
        x.globalCompositeOperation = 'source-over';
      }
      // Lit: the bin lit from the sun direction in this ship's frame.
      x.drawImage(bins ? bins[fleetBin(s.a - SPRITE_NOSE)] : shipSmall, -sz / 2, -sz / 2, sz, sz);
    }
    x.setTransform(1, 0, 0, 1, 0, 0);
  }

  function fleetKick() {
    var want = !fleet.paused && fleet.visible && fleet.onScreen;
    if (!want) { fleet.running = false; fleetDraw(); return; }
    if (fleet.running) return;
    fleet.running = true;
    fleet.last = 0;
    requestAnimationFrame(fleetFrame);
  }
  function fleetFrame(now) {
    if (!fleet.running) return;
    if (fleet.paused || !fleet.visible || !fleet.onScreen) { fleet.running = false; return; }
    var dt = fleet.last ? Math.min(0.05, (now - fleet.last) / 1000) : 0.016;
    fleet.last = now;
    // In the screensaver the sun turns slowly. The fleet sprites are lit
    // per plane angle, so this costs no new shading.
    if (saverOn) sun.az = wrapAz(sun.az + dt * 0.06);
    fleetStep(dt);
    fleetDraw();
    requestAnimationFrame(fleetFrame);
  }

  // ── SUN DIAL AND LOOK ──
  // The dial is a top view of the sky over the ship. The knob angle is the
  // sun plane angle. The knob distance from the centre is the sun height:
  // the centre is high (EL_MAX), the rim is low (EL_MIN). A drag or an arrow
  // key stops Auto.
  function placeKnob() {
    var k = $('sunKnob');
    if (!k) return;
    var r = (EL_MAX - sun.el) / (EL_MAX - EL_MIN);
    k.style.left = (50 + Math.cos(sun.az) * r * 50) + '%';
    k.style.top = (50 + Math.sin(sun.az) * r * 50) + '%';
    var deg = Math.round(((sun.az * 180 / Math.PI) + 450) % 360);
    $('sunDial').setAttribute('aria-valuetext', 'Sun from ' + deg + ' degrees, ' + Math.round(sun.el * 180 / Math.PI) + ' degrees high');
  }
  function setSun(az, el, user) {
    sun.az = wrapAz(az);
    sun.el = Math.max(EL_MIN, Math.min(EL_MAX, el));
    if (user && sun.auto) setAuto(false);
    placeKnob();
    scheduleRelight(true);
    if (lit.binsEl === null || Math.abs(sun.el - lit.binsEl) > 0.015) scheduleBins();
  }
  function syncLook() {
    var on = lit.on && lit.ok;
    document.querySelectorAll('#lookSeg button').forEach(function (b) {
      var me = b.dataset.look === (on ? 'lit' : 'flat');
      b.classList.toggle('on', me);
      b.setAttribute('aria-pressed', me ? 'true' : 'false');
      if (b.dataset.look === 'lit') b.disabled = !lit.ok;
    });
    var ctl = $('lightCtl');
    if (ctl) ctl.classList.toggle('flat', !on);
    $('hero').classList.toggle('lit', on);
  }
  function setLook(on) {
    lit.on = !!on;
    syncLook();
    relight();
    rebuildFleet();
    drawThumbs();
    fleetKick();
    if (!saverOn) writeHash();
    sunKick();
  }
  function setAuto(on) {
    sun.auto = !!on;
    var b = $('btnSunAuto');
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.classList.toggle('on', !!on);
    sunKick();
  }
  // Auto: the sun turns while the hero is on screen, the tab is visible and
  // the look is Lit. One relight per frame at most.
  var sunLoop = { running: false, last: 0, heroOn: true };
  function sunKick() {
    var want = sun.auto && heroLit() && sunLoop.heroOn && !document.hidden && !saverOn;
    if (!want) { sunLoop.running = false; return; }
    if (sunLoop.running) return;
    sunLoop.running = true; sunLoop.last = 0;
    requestAnimationFrame(sunFrame);
  }
  function sunFrame(now) {
    if (!sunLoop.running) return;
    if (!(sun.auto && heroLit() && sunLoop.heroOn && !document.hidden && !saverOn)) { sunLoop.running = false; return; }
    var dt = sunLoop.last ? Math.min(0.1, (now - sunLoop.last) / 1000) : 0.016;
    sunLoop.last = now;
    sun.az = wrapAz(sun.az + dt * 0.35);
    placeKnob();
    // A phone shades the 256 surface while the sun turns; the full relight
    // comes when Auto stops.
    relight(lit.lite);
    if (!fleet.running) fleetDraw();
    requestAnimationFrame(sunFrame);
  }
  function buildSun() {
    var dial = $('sunDial');
    function fromPointer(e) {
      var r = dial.getBoundingClientRect();
      if (!r.width) return;
      var dx = (e.clientX - r.left - r.width / 2) / (r.width / 2), dy = (e.clientY - r.top - r.height / 2) / (r.height / 2);
      var len = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      setSun(len > 0.02 ? Math.atan2(dy, dx) : sun.az, EL_MAX - len * (EL_MAX - EL_MIN), true);
    }
    dial.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (dial.setPointerCapture) dial.setPointerCapture(e.pointerId);
      dial.classList.add('drag');
      fromPointer(e);
      function move(ev) { fromPointer(ev); }
      function up() {
        dial.classList.remove('drag');
        dial.removeEventListener('pointermove', move);
        dial.removeEventListener('pointerup', up);
        dial.removeEventListener('pointercancel', up);
      }
      dial.addEventListener('pointermove', move);
      dial.addEventListener('pointerup', up);
      dial.addEventListener('pointercancel', up);
    });
    dial.addEventListener('keydown', function (e) {
      var d = { ArrowLeft: [-0.15, 0], ArrowRight: [0.15, 0], ArrowUp: [0, 0.06], ArrowDown: [0, -0.06] }[e.key];
      if (!d) return;
      e.preventDefault();
      setSun(sun.az + d[0], sun.el + d[1], true);
    });
    document.querySelectorAll('#lookSeg button').forEach(function (b) {
      b.addEventListener('click', function () { setLook(b.dataset.look === 'lit'); });
    });
    $('btnSunAuto').addEventListener('click', function () { setAuto(!sun.auto); });
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (es) { sunLoop.heroOn = es[0].isIntersecting; sunKick(); }, { threshold: 0.01 }).observe($('hero'));
    }
    document.addEventListener('visibilitychange', sunKick);
    placeKnob();
    syncLook();
  }

  // ── BOOT ──
  // Load the six layer images, then build the UI and start the fleet.
  function loadLayers(done) {
    var paths = layerPaths(), out = {}, left = 6, failed = false;
    Object.keys(paths).forEach(function (slug) {
      out[slug] = {};
      ['base', 'mask'].forEach(function (k) {
        var img = new Image();
        img.onload = function () { if (--left === 0 && !failed) done(out); };
        img.onerror = function () { failed = true; toast('Ship art did not load'); };
        img.src = paths[slug][k];
        out[slug][k] = img;
      });
    });
  }

  function boot() {
    var moved = readHash();
    buildPicker();
    buildSheet();
    buildSun();
    $('btnPng').addEventListener('click', exportPng);
    $('btnLink').addEventListener('click', copyLink);
    window.addEventListener('hashchange', function () { migrateNote(readHash()); syncLook(); drawThumbs(); schedulePaint(); });
    fleetInit();
    syncUi();
    migrateNote(moved);
    loadLayers(function (l) {
      layers = l;
      buildPresets();
      paint();
      fleetKick();
      // Then the light: the surfaces, the lit thumbnails, a lit repaint.
      buildSurfaces(function () {
        drawThumbs();
        paint();
        fleetKick();
        sunKick();
        lit.ready = true;
      });
    });
  }

  // Test hook for tests.mjs. It changes nothing on the page.
  window.__snShipDesigner = {
    state: state, sun: sun, lit: lit, presets: PRESETS, FLEET_BINS: FLEET_BINS,
    setLook: setLook, setSun: setSun, setAuto: setAuto, relight: relight,
    fleetBin: fleetBin, hashString: hashString, readHash: readHash, paint: paint
  };

  // ── SCREENSAVER HOOK ──
  // The shell (lib/screensaver.js) calls enter() in screensaver mode. It pins
  // #fleetWrap full frame, so the ResizeObserver sizes the canvas, and hides
  // the rest of the page. The seed picks the livery and the flight mode. The
  // calm value slows the fleet and the engine flicker.
  window.snSaver = {
    enter: function (opts) {
      var calm = Math.max(0, Math.min(1, opts && opts.calm != null ? opts.calm : 0.7));
      var seed = (opts && opts.seed) || 0;
      saverOn = true;
      var st = document.createElement('style');
      st.textContent = 'html, body { overflow: hidden !important; }' +
        'header.top, #hero, .card.fleet .card-head, #panel, .toast { display: none !important; }' +
        '.card.fleet { backdrop-filter: none; -webkit-backdrop-filter: none; overflow: visible; border: 0; }' +
        '#fleetWrap { position: fixed; inset: 0; height: auto; z-index: 100; cursor: none; }';
      document.head.appendChild(st);
      applyPreset(PRESETS[seed % PRESETS.length]);
      fleet.speed = 1 - 0.6 * calm;
      fleet.flick = 4 + 8 * (1 - calm);
      fleet.size = 52; fleet.count = 20; fleet.push = null;
      fleet.mode = seed % 2 ? 'wander' : 'formation';
      fleetSeed();
      fleet.paused = false; fleet.onScreen = true;
      fleetResize(); fleetKick();
      // The plate: the livery (PRESETS name, the three colours, the trim
      // pattern), the layer blend of composeShip, and the steering law of
      // fleetStep for the flight mode. The mode does not change in the
      // saver, so one plate holds for the whole dwell.
      if (opts && typeof opts.label === 'function') {
        var pr = PRESETS[seed % PRESETS.length], tr = TRIMS.filter(function (t) { return t.id === state.pattern; })[0];
        var eq = fleet.mode === 'wander' ? [
          'w = 0.8 sin(0.7t + p) + 0.5 sin(0.31t + 1.7p)',
          'θ̇ = 1.2·(w + 2·min(1.5, |a|)·Δθ_a)',
          'a = Σ_j d̂·(R − d)/R,  R = 1.3·size',
          'x += v(cos θ, sin θ)dt',
          'v = 1.4·size·speed·s_i'
        ] : [
          'leader c = (W(½ + 0.36 sin φ), H(½ + 0.32 sin(2φ + q)))',
          'φ = 0.22t + 2πq/Q  (squadron q of Q)',
          'slot g = c + rot(θ_c)(−r·gap, ±0.75·r·gap),  gap = 1.15·size',
          'v += (ċ + 4(g − x) − v)·min(1, 6dt)'
        ];
        // TeX of the same laws. The page has no TeX or math colour classes,
        // so no rules. The fleet flies over the whole window, so no anchor.
        var tex = fleet.mode === 'wander' ? [
          '\\dot\\theta = 1.2\\left(w + 2\\min(1.5,\\,|a|)\\,\\Delta\\theta_a\\right)',
          'w = 0.8\\sin(0.7t + p) + 0.5\\sin(0.31t + 1.7p)',
          'a = \\sum_j \\hat d\\,\\frac{R - d}{R}, \\qquad R = 1.3\\,\\text{size}'
        ] : [
          'v \\mathrel{+}= \\left(\\dot c + 4(g - x) - v\\right)\\min(1,\\,6\\,dt)',
          'g = c + \\mathrm{rot}(\\theta_c)\\,(-r\\,\\text{gap},\\ \\pm 0.75\\,r\\,\\text{gap})',
          '\\varphi = 0.22\\,t + 2\\pi q/Q'
        ];
        opts.label({
          title: pr[0] + ' livery',
          sub: (fleet.mode === 'wander' ? 'Wander' : 'Formation, squadrons of 7') + ', ' + fleet.count + ' ships',
          params: [
            { name: 'hull', value: state.hull }, { name: 'trim', value: state.trim }, { name: 'accent', value: state.accent },
            { name: 'trim pattern', value: tr ? tr.name : state.pattern }
          ],
          lines: ['Layers: hull, trim, cockpit, accent. Each tints a over grey b, cut by its mask.',
            'One sun lights the ships: soft terminator, plate highlights, cool fill, self shadows.'],
          tex: ['\\text{overlay}(a, b) = \\begin{cases} 2ab, & b < \\tfrac12 \\\\ 1 - 2(1 - a)(1 - b), & b \\ge \\tfrac12 \\end{cases}'].concat(tex),
          eq: ['overlay = b < ½ ? 2ab : 1 − 2(1 − a)(1 − b)'].concat(eq)
        });
      }
      return { canvas: fleet.canvas, warmupMs: 500 };
    }
  };

  boot();
})();
