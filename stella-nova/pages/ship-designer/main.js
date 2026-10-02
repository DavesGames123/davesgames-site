// ============================================================================
//  SHIP DESIGNER  ·  livery painter with a flying fleet
// ----------------------------------------------------------------------------
//  A classic script. It loads three ship layers (hull, cockpit, accents) and
//  their tint masks as webp files from media/sprites/ship-livery/. The paths
//  come from window.SN_DATA (lib/game-data/catalog.js) when it is present.
//  Three colours paint the ship: hull, trim (a second hull tone inside a trim
//  pattern) and accent. The cockpit keeps its own colours.
//
//  LAYER STACK   (bottom to top, built by composeShip)
//      hull grey   + hull colour   (overlay)  cut to the hull mask
//      hull grey   + trim colour   (overlay)  cut to hull mask AND trim pattern
//      cockpit                     (normal)   cut to the cockpit mask
//      accent grey + accent colour (overlay)  cut to the accent mask
//
//  DATA PATH
//      control input -> setColour / setTrim -> state -> schedulePaint()
//      paint() -> composeShip(512) -> #shipCanvas, fleet sprite, URL hash
//      fleet.frame() runs only while the fleet card is on screen, the tab is
//      visible and the user has not paused it.
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//      layer paths ........ "var LAYER_FALLBACK"
//      presets ............ "var PRESETS"
//      trim patterns ...... "var TRIMS"
//      state .............. "var state"
//      colour maths ....... "function hexToRgb"
//      compositing ........ "function composeShip"
//      paint and sync ..... "function paint"
//      URL hash ........... "function readHash"
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
  // Site liveries: [name, hull, accent]. The trim colour of a preset is a
  // darker tone of the hull, and the trim pattern is 'none'.
  var PRESETS = [
    ['Viper', '#1a6b3a', '#b8901e'], ['Crimson', '#8a1a1a', '#d0d0d8'], ['Phantom', '#181820', '#e04040'],
    ['Imperial', '#e8e0d0', '#c8a030'], ['Nebula', '#3020a0', '#00e8ff'], ['Inferno', '#cc3300', '#ff9900'],
    ['Arctic', '#d0e8f0', '#2080c0'], ['Synth', '#200840', '#ff40ff'], ['Militia', '#3a4a30', '#7a8a60'],
    ['Chrome', '#808890', '#40e0d0'], ['Monarch', '#4a0060', '#ffd700'], ['Stealth', '#1a1a1e', '#333340'],
    ['Coral', '#ff6b6b', '#ffd93d'], ['Oceanic', '#006994', '#40e0d0'], ['Ember', '#8b0000', '#ff4500'],
    ['Frost', '#e8f4f8', '#88ccee'], ['Jade', '#005544', '#50c878'], ['Sunset', '#ff6347', '#ffa500'],
    ['Void', '#0a0a14', '#6600cc'], ['Hazard', '#222222', '#ffcc00'], ['Lotus', '#ff69b4', '#fff0f5'],
    ['Tundra', '#c8d0d0', '#6a8a8a'], ['Scorpion', '#5a3a00', '#cc8800'], ['Wraith', '#2a2a3a', '#8866ff'],
    ['Venom', '#004400', '#88ff00'], ['Sakura', '#ffb7c5', '#880044'], ['Blitz', '#0044aa', '#ffcc00'],
    ['Obsidian', '#101018', '#cc0000'], ['Polaris', '#001133', '#aaeeff'], ['Rustic', '#8b4513', '#daa520'],
    ['Neon', '#0d0d0d', '#39ff14'], ['Regal', '#1a0033', '#c0a0ff'], ['Sandstorm', '#c2b280', '#8b7355'],
    ['Plasma', '#220033', '#ff00ff'], ['Osprey', '#36454f', '#c0c0c0'], ['Aurora', '#004466', '#66ffcc'],
    ['Magma', '#330000', '#ff3300'], ['Glacier', '#f0f8ff', '#4682b4'], ['Hornet', '#111100', '#ffdd00'],
    ['Specter', '#1a1a2e', '#e94560']
  ];

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
  var state = { hull: '#1a6b3a', trim: '#0f3d22', accent: '#b8901e', pattern: 'none', channel: 'hull' };
  var layers = null;        // { hull: {base, mask}, ... } decoded Image objects
  var shipFull = null;      // 512 x 512 composite
  var shipSmall = null;     // 128 x 128 composite for the fleet

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

  // ── PAINT AND SYNC ──
  var paintQueued = false;
  function schedulePaint() {
    if (paintQueued) return;
    paintQueued = true;
    (window.requestAnimationFrame || setTimeout)(function () { paintQueued = false; paint(); });
  }
  function paint() {
    shipFull = composeShip(512, state, $('shipCanvas'));
    shipSmall = shipSmall || makeCanvas(128);
    var sx = shipSmall.getContext('2d');
    sx.clearRect(0, 0, 128, 128);
    sx.imageSmoothingQuality = 'high';
    sx.drawImage(shipFull, 0, 0, 128, 128);
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
  // Format: #hull=1a6b3a&trim=0f3d22&accent=b8901e&pattern=spine
  function readHash() {
    var h = (location.hash || '').replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (kv) {
      var p = kv.split('='), k = p[0], v = decodeURIComponent(p[1] || '');
      if (k === 'hull' || k === 'trim' || k === 'accent') { var c = normHex(v); if (c) state[k] = c; }
      if (k === 'pattern' && TRIMS.some(function (t) { return t.id === v; })) state.pattern = v;
    });
  }
  function hashString() {
    return 'hull=' + state.hull.slice(1) + '&trim=' + state.trim.slice(1) + '&accent=' + state.accent.slice(1) + '&pattern=' + state.pattern;
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
    PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'preset'; b.dataset.name = p[0];
      b.setAttribute('aria-label', 'Livery ' + p[0]);
      var c = makeCanvas(96);
      composeShip(96, { hull: p[1], trim: p[1], accent: p[2], pattern: 'none' }, c);
      var s = document.createElement('span'); s.textContent = p[0];
      b.appendChild(c); b.appendChild(s);
      b.addEventListener('click', function () { applyPreset(p); });
      grid.appendChild(b);
    });
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
    var c = composeShip(1024, state);
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
        // Face the leader heading when in the slot, the flight path when not.
        var off = Math.min(1, Math.sqrt(ex * ex + ey * ey) / (gap * 2));
        var want = sp > 4 ? Math.atan2(s.vy, s.vx) : la;
        want = la + wrapAngle(want - la) * off;
        s.a = wrapAngle(s.a + wrapAngle(want - s.a) * Math.min(1, dt * 6));
      }
    }
  }

  function fleetDraw() {
    var x = fleet.ctx, d = fleet.dpr;
    if (!x) return;
    x.setTransform(1, 0, 0, 1, 0, 0);
    if (fleet.bg) x.drawImage(fleet.bg, 0, 0); else { x.fillStyle = '#05070d'; x.fillRect(0, 0, fleet.canvas.width, fleet.canvas.height); }
    if (!shipSmall) return;
    var sz = fleet.size, t = fleet.t;
    for (var i = 0; i < fleet.ships.length; i++) {
      var s = fleet.ships[i];
      x.setTransform(d, 0, 0, d, s.x * d, s.y * d);
      x.rotate(s.a + Math.PI / 2);
      if (fleet.glow) {
        x.globalCompositeOperation = 'lighter';
        var fl = 0.8 + 0.2 * Math.sin(t * fleet.flick + i * 1.7);
        x.globalAlpha = 0.85;
        x.drawImage(fleet.flame, -sz * 0.09, sz * 0.38, sz * 0.18, sz * 0.55 * fl);
        x.globalAlpha = 1;
        x.globalCompositeOperation = 'source-over';
      }
      x.drawImage(shipSmall, -sz / 2, -sz / 2, sz, sz);
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
    fleetStep(dt);
    fleetDraw();
    requestAnimationFrame(fleetFrame);
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
    readHash();
    buildPicker();
    buildSheet();
    $('btnPng').addEventListener('click', exportPng);
    $('btnLink').addEventListener('click', copyLink);
    window.addEventListener('hashchange', function () { readHash(); schedulePaint(); });
    fleetInit();
    syncUi();
    loadLayers(function (l) {
      layers = l;
      buildPresets();
      paint();
      fleetKick();
    });
  }

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
      return { canvas: fleet.canvas, warmupMs: 500 };
    }
  };

  boot();
})();
